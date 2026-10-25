// Simulated agents: same strategies, same live prices, paper fills. They hold no funds and never touch the chain.
import { STRATS, STRAT_KEYS, computeTargets, planOrders, LIMITS, type AssetKind, type StratKey } from "@stonkquant/core";
import { sql, logEvent } from "./db";
import { env } from "./env";
import { market } from "./market";
import type { AgentRow, Holding } from "./agents";

export const SIM_OWNER = "simulated";

interface Paper { cash: number; qty: Record<string, number> }

const SIM_NAMES: Record<StratKey, string> = {
  MOMENTUM: "SIM-MONK", MEANREV: "SIM-GOBLIN", INDEX: "SIM-HUGGER", PREIPO: "SIM-PROPHET", SNIPER: "SIM-SNIPER", BURNER: "SIM-FARMER",
};
const SIM_RISK: Record<StratKey, number> = { MOMENTUM: 6, MEANREV: 5, INDEX: 8, PREIPO: 7, SNIPER: 9, BURNER: 6 };

/** Create (or retire) the simulated agents to match SIM_AGENTS. */
export async function ensureSimAgents() {
  await sql`INSERT INTO users (wallet) VALUES (${SIM_OWNER}) ON CONFLICT DO NOTHING`;
  const want = Math.max(0, Math.min(STRAT_KEYS.length * 3, env.sim.count));
  const live = await sql<{ id: number }[]>`SELECT id FROM agents WHERE sim AND status <> 'retired' ORDER BY id`;
  if (want === 0) {
    if (live.length) await sql`UPDATE agents SET status = 'retired', updated_at = now() WHERE sim AND status <> 'retired'`;
    return;
  }
  for (let i = live.length; i < want; i++) {
    const strat = STRAT_KEYS[i % STRAT_KEYS.length];
    const round = Math.floor(i / STRAT_KEYS.length);
    const name = SIM_NAMES[strat] + (round ? `-${round + 1}` : "");
    const deposit = env.sim.deposit;
    const state = { paper: { cash: deposit, qty: {} } };
    const [row] = await sql<{ id: number }[]>`
      INSERT INTO agents (owner, name, strat, risk, cadence_mul, uni, color, status, sim, deposited_usd, equity_usd, cash_usd, state)
      VALUES (${SIM_OWNER}, ${name}, ${strat}, ${SIM_RISK[strat]}, 1, ${STRATS[strat].uni as string[]}, ${i % 6}, 'live', true, ${deposit}, ${deposit}, ${deposit}, ${sql.json(state as any)})
      ON CONFLICT DO NOTHING RETURNING id`;
    if (row) await logEvent(row.id, "boot", `simulated agent spawned with $${deposit} of paper USDC (no real funds)`);
  }
}

const slip = (kind: AssetKind | undefined) => (kind === "xstock" || kind === "prestock" ? 0.001 : kind === "stonk" ? 0.003 : 0.01);
const FEE = 0.0025;
const fmt = (x: number) => "$" + x.toFixed(2);
const qtyFmt = (q: number) => (q >= 1000 ? q.toLocaleString("en-US", { maximumFractionDigits: 0 }) : q >= 1 ? q.toFixed(3) : q.toPrecision(3));
const px = (p: number) => (p >= 1 ? "$" + p.toFixed(2) : "$" + p.toPrecision(3));

function snapshot(paper: Paper, entry: Record<string, number>) {
  const values: Record<string, number> = {};
  const holdings: Record<string, Holding> = {};
  for (const [m, q] of Object.entries(paper.qty)) {
    if (q <= 0) continue;
    const price = market.price(m) ?? 0;
    const a = market.assets.get(m);
    values[m] = q * price;
    holdings[m] = { sym: a?.sym ?? m.slice(0, 4), ui: q, value: q * price, price, entry: entry[m] };
  }
  const equity = paper.cash + Object.values(values).reduce((s, v) => s + v, 0);
  return { values, holdings, equity };
}

export async function runPaper(ag: AgentRow, minute: number) {
  const st = (ag.state ?? {}) as AgentRow["state"] & { paper?: Paper };
  const paper: Paper = st.paper ? { cash: st.paper.cash, qty: { ...st.paper.qty } } : { cash: ag.deposited_usd || env.sim.deposit, qty: {} };
  const state = { ...st, entry: { ...(st.entry ?? {}) }, paper };
  let trades = 0, volume = 0, rebalanced = false;

  const cad = Math.max(1, Math.round(STRATS[ag.strat].cad * (ag.cadence_mul || 1)));
  const due = ag.status === "live" && (!ag.last_rebalance_at || Date.now() - new Date(ag.last_rebalance_at).getTime() >= cad * 60_000 - 5_000);
  let nextOffsetMin = 0;

  if (due) {
    rebalanced = true;
    const s = snapshot(paper, state.entry);
    const t = computeTargets({ strat: ag.strat, risk: ag.risk, uni: ag.uni, values: s.values, entry: state.entry }, market.view());
    const all = planOrders(s.values, paper.cash, t, LIMITS.minTradeUsd, 999);
    const orders = all.slice(0, LIMITS.maxOrdersPerRebalance);
    if (all.length > orders.length) nextOffsetMin = Math.max(0, cad - 2);
    else if (t.warming) nextOffsetMin = Math.max(0, cad - 5);

    if (t.note !== state.lastNote || !state.lastThinkAt || Date.now() - state.lastThinkAt > 30 * 60_000) {
      await logEvent(ag.id, "think", orders.length ? t.note : `${t.note} · no rebalance needed`);
      state.lastThinkAt = Date.now();
      state.lastNote = t.note;
    }
    for (const o of orders) {
      const price = market.price(o.mint);
      if (!price) continue;
      const a = market.assets.get(o.mint);
      const sym = a?.sym ?? o.mint.slice(0, 4);
      const k = a?.kind;
      if (o.side === "sell") {
        const held = paper.qty[o.mint] ?? 0;
        const q = o.fraction >= 0.999 ? held : held * o.fraction;
        if (q <= 0) continue;
        const got = q * price * (1 - slip(k)) * (1 - FEE);
        const pnl = state.entry[o.mint] ? price / state.entry[o.mint] - 1 : 0;
        paper.qty[o.mint] = held - q;
        if (paper.qty[o.mint] * price < 0.01) { delete paper.qty[o.mint]; delete state.entry[o.mint]; }
        paper.cash += got;
        await logEvent(ag.id, "sell", `SELL ${qtyFmt(q)} ${sym} @ ${px(price)} for ${fmt(got)}${pnl ? ` (${pnl >= 0 ? "+" : ""}${(pnl * 100).toFixed(1)}%)` : ""} · paper`);
        volume += got;
      } else {
        const spend = Math.min(o.usd, paper.cash);
        if (spend < LIMITS.minTradeUsd) continue;
        const fill = price * (1 + slip(k));
        const q = (spend * (1 - FEE)) / fill;
        const prevQ = paper.qty[o.mint] ?? 0;
        state.entry[o.mint] = ((state.entry[o.mint] ?? fill) * prevQ + fill * q) / (prevQ + q);
        paper.qty[o.mint] = prevQ + q;
        paper.cash -= spend;
        await logEvent(ag.id, "buy", `BUY ${qtyFmt(q)} ${sym} @ ${px(fill)} for ${fmt(spend)} · paper`);
        volume += spend;
      }
      trades++;
    }
  }

  const s = snapshot(paper, state.entry);
  if (rebalanced) {
    await sql`UPDATE agents SET state = ${sql.json(state as any)}, note = ${state.lastNote ?? null},
      last_rebalance_at = now() - make_interval(mins => ${nextOffsetMin}), trades = trades + ${trades}, volume_usd = volume_usd + ${volume}, updated_at = now() WHERE id = ${ag.id}`;
  }
  await sql`UPDATE agents SET equity_usd = ${s.equity}, cash_usd = ${paper.cash}, holdings = ${sql.json(s.holdings as any)}, updated_at = now() WHERE id = ${ag.id}`;
  if (minute % 5 === 0) {
    const ts = new Date(Math.floor(Date.now() / 60000) * 60000);
    await sql`INSERT INTO agent_equity (agent_id, ts, equity) VALUES (${ag.id}, ${ts}, ${s.equity}) ON CONFLICT DO NOTHING`;
  }
}
