import { INDEX_WEIGHTS, STONK_MINT, isLaunchCoin, type AssetKind } from "./assets";
import type { ExitWhy, Learn } from "./learn";

export type StratKey = "MOMENTUM" | "MEANREV" | "INDEX" | "PREIPO" | "SNIPER" | "BURNER";

export interface StratDef {
  label: string;
  hat: string[];
  cad: number; // minutes between rebalances at cadence multiplier 1
  uni: AssetKind[];
  desc: string;
}

export const STRATS: Record<StratKey, StratDef> = {
  MOMENTUM: { label: "Momentum Monk", hat: ["   .-^-.   "], cad: 15, uni: ["xstock", "prestock", "pair", "pump", "otc", "stonk"], desc: "Rides the three strongest 60-minute trends." },
  MEANREV: { label: "Reversion Goblin", hat: ["   /\\ /\\   "], cad: 20, uni: ["xstock", "prestock", "stonk"], desc: "Buys stretched dips back toward the 2-hour mean." },
  INDEX: { label: "Index Hugger", hat: ["   ▄▄▄▄▄   "], cad: 240, uni: ["xstock"], desc: "Holds a cap-weighted xStock basket, rebalances lazily." },
  PREIPO: { label: "Pre-IPO Prophet", hat: ["    /^\\    "], cad: 60, uni: ["prestock", "pair", "pump"], desc: "PreStocks plus the launchpad coins quoted in them." },
  SNIPER: { label: "Pair Sniper", hat: ["  ==[+]==  "], cad: 5, uni: ["pair", "pump", "otc"], desc: "Hunts breakouts on stock-paired launchpad coins, quick exits." },
  BURNER: { label: "Flywheel Farmer", hat: ["   ( ) )   ", "   ) ( (   "], cad: 120, uni: ["stonk", "pair", "otc"], desc: "Stacks STONK and the strongest reward-paying coins." },
};

export const STRAT_KEYS = Object.keys(STRATS) as StratKey[];

/** Price history for one asset, oldest first, one point per minute. */
export interface MarketAsset {
  mint: string;
  sym: string;
  kind: AssetKind;
  quoteMint?: string | null;
  h: number[];
}

export interface AgentView {
  strat: StratKey;
  risk: number; // 1..10
  uni: AssetKind[];
  /** current USD value per mint */
  values: Record<string, number>;
  /** volume-weighted entry price per mint */
  entry: Record<string, number>;
  /** highest price seen per held mint since entry (for trailing take-profit) */
  peak?: Record<string, number>;
  /** mints the agent recently exited on a risk rule, epoch ms until it may re-enter */
  cooldown?: Record<string, number>;
  /** epoch ms when each position was opened */
  entryAt?: Record<string, number>;
  /** USDC on hand (needed to turn position values into weights) */
  cash?: number;
  /** parameters this agent has learned from its own closed trades */
  learn?: Learn;
}

/** Minimum minutes a strategy holds a new position before it may sell it (risk exits excepted). Cuts fee churn. */
export const MIN_HOLD_MIN: Record<StratKey, number> = { MOMENTUM: 240, MEANREV: 120, INDEX: 0, PREIPO: 0, SNIPER: 0, BURNER: 0 };

/* ---------------- risk overlay (applies to every agent, real and simulated) ---------------- */

/** stop-loss, take-profit arm level and trailing give-back per asset type */
export const RISK_RULES: Record<AssetKind, { stop: number; arm: number; trail: number }> = {
  // Wide on purpose: tight stops on noisy assets just lock in losses and pay fees.
  xstock: { stop: 0.07, arm: 0.06, trail: 0.03 },
  prestock: { stop: 0.12, arm: 0.12, trail: 0.06 },
  stonk: { stop: 0.18, arm: 0.25, trail: 0.1 },
  pair: { stop: 0.25, arm: 0.4, trail: 0.15 },
  pump: { stop: 0.25, arm: 0.4, trail: 0.15 },
  otc: { stop: 0.25, arm: 0.4, trail: 0.15 },
};
export const RISK_COOLDOWN_MS = 6 * 3600_000;
const SPY_MINT = "XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W";

export interface RiskExit { mint: string; reason: string; why: ExitWhy }

/** Positions that must be closed now: stop-loss hit, or a winner gave back its trailing buffer. */
export function riskExits(ag: AgentView, market: MarketAsset[]): RiskExit[] {
  const out: RiskExit[] = [];
  const byMint = new Map(market.map((a) => [a.mint, a]));
  for (const [m, v] of Object.entries(ag.values)) {
    if (!(v > 1)) continue;
    const a = byMint.get(m);
    const e = ag.entry[m];
    if (!a || !e) continue;
    const p = last(a), rule = RISK_RULES[a.kind];
    const stop = rule.stop * (ag.learn?.stop ?? 1), trail = rule.trail * (ag.learn?.trail ?? 1);
    const pk = Math.max(ag.peak?.[m] ?? p, p);
    const pnl = p / e - 1;
    if (pnl <= -stop) out.push({ mint: m, why: "stop", reason: `stop-loss ${a.sym} at ${pct(pnl)}` });
    else if (pk / e - 1 >= rule.arm && p / pk - 1 <= -trail) out.push({ mint: m, why: "trail", reason: `took profit on ${a.sym} at ${pct(pnl)}` });
  }
  return out;
}

/** Broad market is falling: SPYx below its 4h mean and down over 4h. */
function riskOff(market: MarketAsset[]) {
  const spy = market.find((a) => a.mint === SPY_MINT);
  if (!spy || spy.h.length < 240) return false;
  return ret(spy, 240) < -0.005 && last(spy) < sma(spy, 240);
}

export interface TargetResult {
  /** target portfolio weight per mint (sum ≤ exposure), rest stays in USDC */
  w: Record<string, number>;
  note: string;
  band: number;
  /** true when nothing in the universe has enough price history yet */
  warming?: boolean;
}

export const exposure = (risk: number) => 0.3 + 0.07 * Math.max(1, Math.min(10, risk));

const last = (a: MarketAsset) => a.h[a.h.length - 1];
export const ret = (a: MarketAsset, n: number) => {
  const h = a.h;
  if (h.length <= n) return 0;
  const p0 = h[h.length - 1 - n];
  return p0 > 0 ? h[h.length - 1] / p0 - 1 : 0;
};
const sma = (a: MarketAsset, n: number) => {
  const h = a.h.slice(-n);
  return h.reduce((s, x) => s + x, 0) / Math.max(1, h.length);
};
const stdRet = (a: MarketAsset, n: number) => {
  const h = a.h.slice(-n - 1);
  const r: number[] = [];
  for (let i = 1; i < h.length; i++) if (h[i - 1] > 0 && h[i] > 0) r.push(Math.log(h[i] / h[i - 1]));
  if (r.length < 2) return 1e-6;
  const m = r.reduce((s, x) => s + x, 0) / r.length;
  return Math.sqrt(r.reduce((s, x) => s + (x - m) ** 2, 0) / r.length) || 1e-6;
};
const pct = (x: number, dp = 1) => (x >= 0 ? "+" : "") + (x * 100).toFixed(dp) + "%";

/** Minimum minutes of history before a strategy will trade an asset. */
export const MIN_HISTORY = 30;

/** Per-position caps (fraction of equity) so no single coin dominates a vault. */
export const POSITION_CAP: Record<AssetKind, number> = { xstock: 0.5, prestock: 0.4, stonk: 0.4, pair: 0.2, pump: 0.15, otc: 0.15 };

export function computeTargets(ag: AgentView, market: MarketAsset[]): TargetResult & { exits: RiskExit[] } {
  const now = Date.now();
  // assets on cooldown after a risk exit are invisible to the strategy
  const cooled = new Set(Object.entries(ag.cooldown ?? {}).filter(([, until]) => until > now).map(([m]) => m));
  const visible = cooled.size ? market.filter((a) => !cooled.has(a.mint) || (ag.values[a.mint] ?? 0) > 1) : market;
  const r = rawTargets(ag, visible);
  const kinds = new Map(market.map((a) => [a.mint, a.kind]));
  // learned sizing per asset type (bounded 0.5–1.5×), never above the risk dial's exposure or the position caps
  const kw = ag.learn?.kind ?? {};
  for (const m in r.w) r.w[m] *= kw[kinds.get(m) ?? "pair"] ?? 1;
  for (const m in r.w) r.w[m] = Math.min(r.w[m], POSITION_CAP[kinds.get(m) ?? "pair"]);
  const tot = Object.values(r.w).reduce((s, x) => s + x, 0), ex = exposure(ag.risk);
  if (tot > ex) for (const m in r.w) r.w[m] *= ex / tot;
  for (const m of cooled) delete r.w[m];

  const notes: string[] = [];
  const exits = riskExits(ag, market);
  // honour the minimum holding period: don't sell a young position just because the signal flickered
  const hold = MIN_HOLD_MIN[ag.strat] * 60_000;
  if (hold) {
    const eq = (ag.cash ?? 0) + Object.values(ag.values).reduce((s, v) => s + v, 0);
    for (const [m, v] of Object.entries(ag.values)) {
      const at = ag.entryAt?.[m];
      if (eq > 0 && v > 1 && at && now - at < hold && !exits.some((x) => x.mint === m)) {
        r.w[m] = Math.max(r.w[m] ?? 0, Math.min(POSITION_CAP[kinds.get(m) ?? "pair"], v / eq));
      }
    }
  }
  for (const x of exits) { r.w[x.mint] = 0; notes.push(x.reason); }

  if (riskOff(market) && ag.strat !== "INDEX") {
    for (const m in r.w) { const k = kinds.get(m); if (k && k !== "xstock") r.w[m] *= 0.5; }
    notes.push("market risk-off: halving non-stock exposure");
  }
  if (notes.length) r.note = `${notes.join(" · ")} · ${r.note}`;
  return { ...r, exits };
}

function rawTargets(ag: AgentView, market: MarketAsset[]): TargetResult {
  const U = market.filter((a) => ag.uni.includes(a.kind) && a.h.length >= MIN_HISTORY && last(a) > 0);
  const ex = exposure(ag.risk);
  const E = ag.learn?.entry ?? 1; // learned entry strictness
  const w: Record<string, number> = {};
  const norm = (raw: Record<string, number>) => {
    const s = Object.values(raw).reduce((x, y) => x + y, 0);
    if (s > 0) for (const k in raw) w[k] = (raw[k] / s) * ex;
  };
  if (!U.length) return { w, note: "collecting price history for my universe, holding USDC", band: 0.03, warming: true };

  switch (ag.strat) {
    case "MOMENTUM": {
      // Hold winners while their hourly trend stays positive; only add a new name on a clear trend.
      // Equal weights + a wide band keep turnover (and fees) low.
      const held = U.filter((a) => (ag.values[a.mint] ?? 0) > 1 && ret(a, 60) > -0.004 && ret(a, 120) > -0.006);
      const fresh = U.filter((a) => !held.includes(a) && ret(a, 60) > 0.008 * E && ret(a, 120) > 0.008 * E && ret(a, 15) > 0)
        .sort((a, b) => ret(b, 60) - ret(a, 60)).slice(0, Math.max(0, 3 - held.length));
      const pick = [...held, ...fresh].slice(0, 3);
      const raw: Record<string, number> = {};
      pick.forEach((a) => (raw[a.mint] = 1));
      norm(raw);
      return { w, band: 0.08, note: pick.length ? `riding ${pick.map((a) => `${a.sym} ${pct(ret(a, 60))}`).join(", ")} over 60m` : "no clear trend, sitting in USDC" };
    }
    case "MEANREV": {
      // Buy only real stretches (≤ -1.2σ), hold until price is back to its mean, then exit.
      const z = U.map((a) => [a, (last(a) / sma(a, 120) - 1) / (stdRet(a, 120) * Math.sqrt(120))] as const);
      const holding = z.filter(([a, v]) => (ag.values[a.mint] ?? 0) > 1 && v < 0);
      const fresh = z.filter(([a, v]) => !((ag.values[a.mint] ?? 0) > 1) && v < -1.2 * E).sort((a, b) => a[1] - b[1]).slice(0, Math.max(0, 3 - holding.length));
      const pick = [...holding, ...fresh].slice(0, 3);
      const raw: Record<string, number> = {};
      pick.forEach(([a]) => (raw[a.mint] = 1));
      norm(raw);
      const worst = z.slice().sort((a, b) => a[1] - b[1])[0];
      return { w, band: 0.08, note: fresh.length ? `${fresh[0][0].sym} stretched ${fresh[0][1].toFixed(1)}σ below its 2h mean` : holding.length ? `holding ${holding.map(([a]) => a.sym).join(", ")} until they revert` : `nothing stretched; widest ${worst[0].sym} at ${worst[1].toFixed(1)}σ` };
    }
    case "INDEX": {
      const raw: Record<string, number> = {};
      U.forEach((a) => { if (INDEX_WEIGHTS[a.sym]) raw[a.mint] = INDEX_WEIGHTS[a.sym]; });
      if (!Object.keys(raw).length) U.forEach((a) => (raw[a.mint] = 1));
      norm(raw);
      return { w, band: 0.025, note: `basket of ${Object.keys(raw).length}, drift band ±2.5%` };
    }
    case "PREIPO": {
      const pre = U.filter((a) => a.kind === "prestock");
      const preMints = new Set(market.filter((a) => a.kind === "prestock").map((a) => a.mint));
      const raw: Record<string, number> = {};
      pre.forEach((a) => (raw[a.mint] = 1 + Math.max(-0.5, Math.min(0.5, ret(a, 240) * 10))));
      U.filter((a) => isLaunchCoin(a.kind) && a.quoteMint && preMints.has(a.quoteMint)).slice(0, 3).forEach((a) => (raw[a.mint] = 0.35));
      norm(raw);
      const best = pre.slice().sort((a, b) => ret(b, 240) - ret(a, 240))[0];
      return { w, band: 0.04, note: best ? `strongest pre-IPO over 4h: ${best.sym} ${pct(ret(best, 240))}` : "needs PreStocks in its universe" };
    }
    case "SNIPER": {
      const pairs = U.filter((a) => isLaunchCoin(a.kind));
      const raw: Record<string, number> = {};
      let exit = "";
      pairs.forEach((a) => {
        if ((ag.values[a.mint] || 0) > 1) {
          const pnl = last(a) / (ag.entry[a.mint] || last(a)) - 1;
          if (pnl > 0.18 * (ag.learn?.trail ?? 1) || pnl < -0.09 * (ag.learn?.stop ?? 1)) { exit = `${a.sym} ${pnl > 0 ? "take-profit" : "stop-loss"} at ${pct(pnl)}`; return; }
          raw[a.mint] = 1;
        }
      });
      const slots = Math.max(0, 2 - Object.keys(raw).length);
      pairs.filter((a) => !raw[a.mint] && ret(a, 15) > 0.05 * E && ret(a, 3) > 0).sort((a, b) => ret(b, 15) - ret(a, 15)).slice(0, slots).forEach((a) => (raw[a.mint] = 1));
      norm(raw);
      const hottest = pairs.slice().sort((a, b) => ret(b, 15) - ret(a, 15))[0];
      return { w, band: 0.05, note: exit || (hottest ? `scanning ${pairs.length} curves, hottest ${hottest.sym} ${pct(ret(hottest, 15))} 15m` : "needs launchpad coins in its universe") };
    }
    case "BURNER": {
      const raw: Record<string, number> = {};
      if (U.some((a) => a.mint === STONK_MINT)) raw[STONK_MINT] = 0.5;
      const top = U.filter((a) => isLaunchCoin(a.kind)).sort((a, b) => ret(b, 240) - ret(a, 240)).slice(0, 2);
      top.forEach((a) => (raw[a.mint] = 0.25));
      norm(raw);
      return { w, band: 0.05, note: `stacking STONK${top.length ? `, farming ${top.map((a) => a.sym).join(", ")}` : ""}` };
    }
  }
}

export interface Order {
  mint: string;
  side: "buy" | "sell";
  /** buy: USD to spend. sell: fraction of the position to sell (0..1]. */
  usd: number;
  fraction: number;
}

/** Turn targets into concrete orders. Sells come first so their USDC can fund buys. */
export function planOrders(values: Record<string, number>, cashUsd: number, t: TargetResult, minTradeUsd: number, maxOrders: number): Order[] {
  const eq = cashUsd + Object.values(values).reduce((s, v) => s + v, 0);
  if (eq <= 0) return [];
  const mints = new Set([...Object.keys(t.w), ...Object.keys(values)]);
  const sells: Order[] = [];
  const buys: Order[] = [];
  mints.forEach((m) => {
    const cur = values[m] || 0;
    const tgt = (t.w[m] || 0) * eq;
    const d = tgt - cur;
    if (d < 0 && (-d > t.band * eq || tgt === 0) && -d >= minTradeUsd) {
      sells.push({ mint: m, side: "sell", usd: -d, fraction: tgt === 0 ? 1 : Math.min(1, -d / cur) });
    } else if (d > 0 && d > t.band * eq && d >= minTradeUsd) {
      buys.push({ mint: m, side: "buy", usd: d, fraction: 0 });
    }
  });
  sells.sort((a, b) => b.usd - a.usd);
  buys.sort((a, b) => b.usd - a.usd);
  let cash = cashUsd + sells.reduce((s, o) => s + o.usd, 0);
  const fundedBuys: Order[] = [];
  for (const b of buys) {
    const spend = Math.min(b.usd, cash * 0.995);
    if (spend < minTradeUsd) break;
    fundedBuys.push({ ...b, usd: spend });
    cash -= spend;
  }
  return [...sells, ...fundedBuys].slice(0, maxOrders);
}
