import { PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createCloseAccountInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { LIMITS, STRATS, USDC_MINT, computeTargets, planOrders, type AssetKind, type StratKey } from "@stonkquant/core";
import { sql, logEvent } from "./db";
import { env } from "./env";
import { market } from "./market";
import { connection, getBalances, priorityIx, signAndSend, type Balances } from "./solana";
import { buildSwap, getQuote } from "./jupiter";
import { createAgentWallet, createWithdrawPolicy } from "./turnkey";

export interface AgentRow {
  id: number;
  owner: string;
  name: string;
  strat: StratKey;
  risk: number;
  cadence_mul: number;
  uni: AssetKind[];
  status: string;
  wallet_id: string | null;
  address: string | null;
  deposited_usd: number;
  withdrawn_usd: number;
  equity_usd: number;
  cash_usd: number;
  holdings: Record<string, Holding>;
  state: { entry?: Record<string, number>; lastThinkAt?: number; lastNote?: string };
  note: string | null;
  trades: number;
  volume_usd: number;
  last_rebalance_at: Date | null;
}

export interface Holding {
  sym: string;
  ui: number;
  value: number;
  price: number;
  entry?: number;
}

const short = (a: string) => a.slice(0, 4) + "…" + a.slice(-4);
const usd = (x: number) => "$" + x.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qty = (q: number) => (Math.abs(q) >= 1000 ? q.toLocaleString("en-US", { maximumFractionDigits: 0 }) : q >= 1 ? q.toFixed(3) : q.toPrecision(3));
const px = (p: number) => (p >= 1 ? "$" + p.toFixed(2) : "$" + p.toPrecision(3));

const decimalsCache = new Map<string, number>();
async function mintDecimals(mint: string): Promise<number> {
  if (mint === USDC_MINT) return 6;
  const hit = decimalsCache.get(mint);
  if (hit !== undefined) return hit;
  const s = await connection.getTokenSupply(new PublicKey(mint));
  decimalsCache.set(mint, s.value.decimals);
  return s.value.decimals;
}

export async function loadAgents(statuses: string[]): Promise<AgentRow[]> {
  return sql<AgentRow[]>`SELECT * FROM agents WHERE status = ANY(${statuses}) ORDER BY id`;
}

/* ---------------- provisioning ---------------- */

export async function provision(ag: AgentRow) {
  const { walletId, address } = await createAgentWallet(ag.id);
  await sql`UPDATE agents SET wallet_id = ${walletId}, address = ${address}, status = 'awaiting_deposit', updated_at = now() WHERE id = ${ag.id} AND status = 'provisioning'`;
  await logEvent(ag.id, "boot", `vault ${short(address)} created. Deposit USDC plus ${LIMITS.gasSol} SOL for fees to go live`);
}

/* ---------------- balances & equity ---------------- */

export interface Snapshot {
  bal: Balances;
  values: Record<string, number>;
  cash: number;
  equity: number;
  holdings: Record<string, Holding>;
}

export async function snapshot(ag: AgentRow): Promise<Snapshot> {
  const bal = await getBalances(ag.address!);
  const cash = bal.tokens[USDC_MINT]?.ui ?? 0;
  const values: Record<string, number> = {};
  const holdings: Record<string, Holding> = {};
  const entry = ag.state.entry ?? {};
  for (const t of Object.values(bal.tokens)) {
    if (t.mint === USDC_MINT || t.raw === 0n) continue;
    const a = market.assets.get(t.mint);
    const price = market.price(t.mint) ?? 0;
    const value = t.ui * price;
    if (a) values[t.mint] = value;
    holdings[t.mint] = { sym: a?.sym ?? short(t.mint), ui: t.ui, value, price, entry: entry[t.mint] };
  }
  const equity = cash + Object.values(values).reduce((s, v) => s + v, 0);
  return { bal, values, cash, equity, holdings };
}

async function saveSnapshot(ag: AgentRow, s: Snapshot, recordEquity: boolean) {
  await sql`UPDATE agents SET equity_usd = ${s.equity}, cash_usd = ${s.cash}, sol_balance = ${s.bal.sol}, holdings = ${sql.json(s.holdings as any)}, updated_at = now() WHERE id = ${ag.id}`;
  if (recordEquity) {
    const ts = new Date(Math.floor(Date.now() / 60000) * 60000);
    await sql`INSERT INTO agent_equity (agent_id, ts, equity) VALUES (${ag.id}, ${ts}, ${s.equity}) ON CONFLICT DO NOTHING`;
  }
}

/* ---------------- funding ---------------- */

const fundedSince = new Map<number, number>();

export async function checkFunding(ag: AgentRow) {
  const s = await snapshot(ag);
  await saveSnapshot(ag, s, false);
  if (s.cash >= 1 && s.bal.sol >= LIMITS.minGasSol) {
    if (ag.deposited_usd <= 0) {
      // No deposit reported by the app yet. Give it a minute, then treat the vault balance as the baseline
      // (covers deposits sent straight from another wallet).
      const since = fundedSince.get(ag.id) ?? Date.now();
      fundedSince.set(ag.id, since);
      if (Date.now() - since < 60_000) return;
      await sql`UPDATE agents SET deposited_usd = ${s.cash} WHERE id = ${ag.id} AND deposited_usd <= 0`;
    }
    fundedSince.delete(ag.id);
    await sql`UPDATE agents SET status = 'live', updated_at = now() WHERE id = ${ag.id} AND status = 'awaiting_deposit'`;
    await logEvent(ag.id, "evt", `funded with ${usd(s.cash)} USDC and ${s.bal.sol.toFixed(3)} SOL, going live`);
  }
}

/* ---------------- trading ---------------- */

function slippageFor(mint: string) {
  const k = market.assets.get(mint)?.kind;
  return k === "xstock" || k === "prestock" ? LIMITS.slippageBpsStock : LIMITS.slippageBpsPair;
}

async function swap(ag: AgentRow, inputMint: string, outputMint: string, amountRaw: bigint, slippageBps: number) {
  const quote = await getQuote(inputMint, outputMint, amountRaw, slippageBps);
  const impact = Number(quote.priceImpactPct) * 100;
  if (Number.isFinite(impact) && impact > LIMITS.maxPriceImpactPct) {
    throw new Error(`price impact ${impact.toFixed(2)}% is above the ${LIMITS.maxPriceImpactPct}% limit`);
  }
  const { tx, lastValidBlockHeight } = await buildSwap(quote, ag.address!);
  const sig = await signAndSend(tx, ag.address!, lastValidBlockHeight);
  return { sig, inAmount: BigInt(quote.inAmount), outAmount: BigInt(quote.outAmount) };
}

export function cadenceMinutes(ag: AgentRow) {
  return Math.max(1, Math.round(STRATS[ag.strat].cad * (ag.cadence_mul || 1)));
}

export async function runLive(ag: AgentRow, minute: number) {
  let s = await snapshot(ag);
  const recordEquity = minute % 5 === 0;

  if (s.bal.sol < LIMITS.minGasSol) {
    await saveSnapshot(ag, s, recordEquity);
    await sql`UPDATE agents SET status = 'paused', note = 'out of SOL for fees, top up to resume', updated_at = now() WHERE id = ${ag.id}`;
    await logEvent(ag.id, "err", `SOL balance ${s.bal.sol.toFixed(4)} is below ${LIMITS.minGasSol}. Paused until topped up`);
    return;
  }

  const due = !ag.last_rebalance_at || Date.now() - new Date(ag.last_rebalance_at).getTime() >= cadenceMinutes(ag) * 60_000 - 5_000;
  if (!due) { await saveSnapshot(ag, s, recordEquity); return; }

  const state = { ...ag.state, entry: { ...(ag.state.entry ?? {}) } };
  const t = computeTargets({ strat: ag.strat, risk: ag.risk, uni: ag.uni, values: s.values, entry: state.entry }, market.view());
  const allOrders = planOrders(s.values, s.cash, t, LIMITS.minTradeUsd, 999);
  const orders = allOrders.slice(0, LIMITS.maxOrdersPerRebalance);
  // If we had to cap the order count, come back in ~2 minutes instead of a full cadence.
  // While price history is still warming up, check again in ~5 minutes.
  const nextOffsetMin = allOrders.length > orders.length ? Math.max(0, cadenceMinutes(ag) - 2) : t.warming ? Math.max(0, cadenceMinutes(ag) - 5) : 0;

  const noteChanged = t.note !== state.lastNote;
  if (noteChanged || !state.lastThinkAt || Date.now() - state.lastThinkAt > 30 * 60_000) {
    await logEvent(ag.id, "think", orders.length ? t.note : `${t.note} · no rebalance needed`);
    state.lastThinkAt = Date.now();
    state.lastNote = t.note;
  }

  let trades = 0, volume = 0;
  if (orders.length && !env.tradingEnabled) {
    await logEvent(ag.id, "evt", `trading is paused platform-wide, skipped ${orders.length} order(s)`);
  } else {
    for (const o of orders) {
      const a = market.assets.get(o.mint);
      const sym = a?.sym ?? short(o.mint);
      const price = market.price(o.mint) ?? 0;
      try {
        if (o.side === "sell") {
          const tb = s.bal.tokens[o.mint];
          if (!tb || tb.raw === 0n) continue;
          const amt = o.fraction >= 0.999 ? tb.raw : (tb.raw * BigInt(Math.round(o.fraction * 1_000_000))) / 1_000_000n;
          if (amt === 0n) continue;
          const r = await swap(ag, o.mint, USDC_MINT, amt, slippageFor(o.mint));
          const got = Number(r.outAmount) / 1e6;
          const soldUi = Number(amt) / 10 ** tb.decimals;
          const pnl = state.entry[o.mint] ? price / state.entry[o.mint] - 1 : 0;
          if (o.fraction >= 0.999) delete state.entry[o.mint];
          await logEvent(ag.id, "sell", `SELL ${qty(soldUi)} ${sym} @ ${px(price)} for ${usd(got)}${pnl ? ` (${pnl >= 0 ? "+" : ""}${(pnl * 100).toFixed(1)}%)` : ""}`, r.sig);
          volume += got;
        } else {
          const usdcRaw = s.bal.tokens[USDC_MINT]?.raw ?? 0n;
          let amt = BigInt(Math.floor(o.usd * 1e6));
          if (amt > usdcRaw) amt = usdcRaw;
          if (Number(amt) / 1e6 < LIMITS.minTradeUsd) continue;
          const prevUi = s.bal.tokens[o.mint]?.ui ?? 0;
          const r = await swap(ag, USDC_MINT, o.mint, amt, slippageFor(o.mint));
          // Measure the fill from the balance change: xStocks use a scaled UI amount, so raw/decimals isn't the real quantity.
          const after = await getBalances(ag.address!);
          let boughtUi = (after.tokens[o.mint]?.ui ?? 0) - prevUi;
          if (!(boughtUi > 0)) boughtUi = Number(r.outAmount) / 10 ** (await mintDecimals(o.mint));
          const spent = Number(amt) / 1e6;
          const fill = boughtUi > 0 ? spent / boughtUi : price;
          const prevEntry = state.entry[o.mint] ?? fill;
          state.entry[o.mint] = (prevEntry * prevUi + fill * boughtUi) / Math.max(1e-12, prevUi + boughtUi);
          await logEvent(ag.id, "buy", `BUY ${qty(boughtUi)} ${sym} @ ${px(fill)} for ${usd(spent)}`, r.sig);
          volume += spent;
        }
        trades++;
        // refresh balances so the next order sees the new USDC amount
        s = await snapshot({ ...ag, state });
      } catch (e) {
        await logEvent(ag.id, "err", `${o.side.toUpperCase()} ${sym} failed: ${(e as Error).message}`);
      }
    }
  }

  await sql`UPDATE agents SET state = ${sql.json(state as any)}, note = ${t.note}, last_rebalance_at = now() - make_interval(mins => ${nextOffsetMin}),
    trades = trades + ${trades}, volume_usd = volume_usd + ${volume}, updated_at = now() WHERE id = ${ag.id}`;
  await saveSnapshot({ ...ag, state }, s, recordEquity);
}

export async function refreshOnly(ag: AgentRow, minute: number) {
  const s = await snapshot(ag);
  await saveSnapshot(ag, s, minute % 5 === 0);
}

/* ---------------- withdrawal ---------------- */

export async function withdraw(ag: AgentRow) {
  if (!env.withdrawalsEnabled) return;
  const address = ag.address!;
  const agentPk = new PublicKey(address);
  const ownerPk = new PublicKey(ag.owner);
  await logEvent(ag.id, "evt", "withdrawal started: selling positions to USDC");

  // 1. Sell everything we can back to USDC.
  let bal = await getBalances(address);
  for (const t of Object.values(bal.tokens)) {
    if (t.mint === USDC_MINT || t.raw === 0n) continue;
    const value = t.ui * (market.price(t.mint) ?? 0);
    if (value < 0.5) continue;
    try {
      const r = await swap(ag, t.mint, USDC_MINT, t.raw, Math.max(slippageFor(t.mint), 150));
      await logEvent(ag.id, "sell", `SELL ${qty(t.ui)} ${market.assets.get(t.mint)?.sym ?? short(t.mint)} for ${usd(Number(r.outAmount) / 1e6)} (withdrawal)`, r.sig);
    } catch (e) {
      await logEvent(ag.id, "err", `couldn't sell ${market.assets.get(t.mint)?.sym ?? short(t.mint)}, sending it as-is: ${(e as Error).message}`);
    }
  }

  // 2. Policy that only allows sends to the owner.
  bal = await getBalances(address);
  const toSend = Object.values(bal.tokens).filter((t) => t.raw > 0n);
  const ownerAtas = toSend.map((t) => getAssociatedTokenAddressSync(new PublicKey(t.mint), ownerPk, false, new PublicKey(t.program)));
  await createWithdrawPolicy(ag.id, ag.wallet_id!, ag.owner, ownerAtas.map((a) => a.toBase58()));
  await new Promise((r) => setTimeout(r, 1500));

  const sigs: string[] = [];
  const usdcOut = bal.tokens[USDC_MINT]?.ui ?? 0;

  // 3. Token transfers, three mints per transaction.
  for (let i = 0; i < toSend.length; i += 3) {
    const tx = new Transaction().add(priorityIx());
    toSend.slice(i, i + 3).forEach((t, j) => {
      const program = new PublicKey(t.program);
      const mint = new PublicKey(t.mint);
      const dest = ownerAtas[i + j];
      tx.add(createAssociatedTokenAccountIdempotentInstruction(agentPk, dest, ownerPk, mint, program));
      tx.add(createTransferCheckedInstruction(new PublicKey(t.account), mint, dest, agentPk, t.raw, t.decimals, [], program));
    });
    try { sigs.push(await signAndSend(tx, address)); }
    catch (e) { await logEvent(ag.id, "err", `token transfer failed: ${(e as Error).message}`); throw e; }
  }

  // 4. Close now-empty token accounts to recover rent (best effort).
  bal = await getBalances(address);
  const empty = Object.values(bal.tokens).filter((t) => t.raw === 0n);
  for (let i = 0; i < empty.length; i += 6) {
    const tx = new Transaction().add(priorityIx());
    empty.slice(i, i + 6).forEach((t) => tx.add(createCloseAccountInstruction(new PublicKey(t.account), agentPk, agentPk, [], new PublicKey(t.program))));
    try { sigs.push(await signAndSend(tx, address)); } catch { /* rent stays in the vault; not fatal */ }
  }

  // 5. Sweep SOL (base fee only, no priority instruction, so the fee is exactly 5000 lamports).
  const lamports = await connection.getBalance(agentPk, "confirmed");
  let solOut = 0;
  if (lamports > 5000) {
    const tx = new Transaction().add(SystemProgram.transfer({ fromPubkey: agentPk, toPubkey: ownerPk, lamports: lamports - 5000 }));
    sigs.push(await signAndSend(tx, address));
    solOut = (lamports - 5000) / 1e9;
  }

  await sql`INSERT INTO withdrawals (agent_id, to_wallet, usdc, sol, sigs) VALUES (${ag.id}, ${ag.owner}, ${usdcOut}, ${solOut}, ${sigs})`;
  await sql`UPDATE agents SET status = 'retired', withdrawn_usd = withdrawn_usd + ${usdcOut}, equity_usd = 0, cash_usd = 0, sol_balance = 0, holdings = '{}'::jsonb, updated_at = now() WHERE id = ${ag.id}`;
  await logEvent(ag.id, "evt", `retired. Sent ${usd(usdcOut)} USDC and ${solOut.toFixed(4)} SOL to ${short(ag.owner)}`, sigs[sigs.length - 1] ?? null);
}
