import { INDEX_WEIGHTS, STONK_MINT, isLaunchCoin, type AssetKind } from "./assets";

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

export function computeTargets(ag: AgentView, market: MarketAsset[]): TargetResult {
  const r = rawTargets(ag, market);
  const kinds = new Map(market.map((a) => [a.mint, a.kind]));
  for (const m in r.w) r.w[m] = Math.min(r.w[m], POSITION_CAP[kinds.get(m) ?? "pair"]);
  return r;
}

function rawTargets(ag: AgentView, market: MarketAsset[]): TargetResult {
  const U = market.filter((a) => ag.uni.includes(a.kind) && a.h.length >= MIN_HISTORY && last(a) > 0);
  const ex = exposure(ag.risk);
  const w: Record<string, number> = {};
  const norm = (raw: Record<string, number>) => {
    const s = Object.values(raw).reduce((x, y) => x + y, 0);
    if (s > 0) for (const k in raw) w[k] = (raw[k] / s) * ex;
  };
  if (!U.length) return { w, note: "collecting price history for my universe, holding USDC", band: 0.03, warming: true };

  switch (ag.strat) {
    case "MOMENTUM": {
      const r = U.map((a) => [a, ret(a, 60)] as const).filter((x) => x[1] > 0.002).sort((a, b) => b[1] - a[1]).slice(0, 3);
      const raw: Record<string, number> = {};
      r.forEach(([a, v]) => (raw[a.mint] = v));
      norm(raw);
      return { w, band: 0.03, note: r.length ? `leaders ${r.map(([a, v]) => `${a.sym} ${pct(v)}`).join(", ")} over 60m` : "no positive trend, sitting in USDC" };
    }
    case "MEANREV": {
      const z = U.map((a) => [a, (last(a) / sma(a, 120) - 1) / (stdRet(a, 120) * Math.sqrt(120))] as const);
      const cands = z.filter((x) => x[1] < -0.6).sort((a, b) => a[1] - b[1]).slice(0, 3);
      const raw: Record<string, number> = {};
      cands.forEach(([a, v]) => (raw[a.mint] = -v));
      // keep holding names that are still below their mean
      z.forEach(([a, v]) => { if ((ag.values[a.mint] || 0) > 1 && v < 0 && !raw[a.mint]) raw[a.mint] = 0.3; });
      norm(raw);
      const worst = z.slice().sort((a, b) => a[1] - b[1])[0];
      return { w, band: 0.03, note: cands.length ? `${cands[0][0].sym} stretched ${cands[0][1].toFixed(1)}σ below its 2h mean` : `nothing stretched; widest ${worst[0].sym} at ${worst[1].toFixed(1)}σ` };
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
          if (pnl > 0.18 || pnl < -0.09) { exit = `${a.sym} ${pnl > 0 ? "take-profit" : "stop-loss"} at ${pct(pnl)}`; return; }
          raw[a.mint] = 1;
        }
      });
      const slots = Math.max(0, 2 - Object.keys(raw).length);
      pairs.filter((a) => !raw[a.mint] && ret(a, 15) > 0.05 && ret(a, 3) > 0).sort((a, b) => ret(b, 15) - ret(a, 15)).slice(0, slots).forEach((a) => (raw[a.mint] = 1));
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
