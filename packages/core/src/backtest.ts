// Event-driven backtester: replays minute prices through the exact same computeTargets / planOrders /
// risk overlay / learner the live agents use, with paper fills (fees + slippage per asset type).
// Strategies only ever see history up to the current minute, and `lookaheadCheck` verifies that.
import type { AssetKind } from "./assets";
import { learnFrom, type Learn } from "./learn";
import { RISK_COOLDOWN_MS, computeTargets, planOrders, riskExits, type MarketAsset, type StratKey } from "./strategies";

export interface BtSeries {
  mint: string; sym: string; kind: AssetKind; quoteMint?: string | null;
  /** minute index (0-based, within the backtest window) of the first price */
  start: number;
  /** one price per minute from `start`, forward-filled */
  p: Float64Array;
}

export interface BtConfig {
  strat: StratKey; risk: number; uni: AssetKind[];
  /** minutes between scheduled rebalances */
  cadenceMin: number;
  engine: "v1" | "v2";
  deposit?: number; minTrade?: number; maxOrders?: number;
  /** let the agent learn from its own closed trades, as live agents do (default true) */
  learn?: boolean;
  /** epoch ms of minute 0 (only affects the clock strategies see) */
  t0?: number;
}

export interface BtTrade { m: number; mint: string; side: "buy" | "sell"; usd: number; price: number }
export interface BtResult {
  strat: StratKey; engine: "v1" | "v2"; minutes: number;
  ret: number; maxDD: number; sharpe: number; trades: number; closed: number; winRate: number;
  fees: number; avgExposure: number; equity: number[]; log: BtTrade[]; learn?: Learn;
}

const HIST = 480;
export const BT_FEE = 0.0025;
export const btSlip = (k: AssetKind | undefined) => (k === "xstock" || k === "prestock" ? 0.001 : k === "stonk" ? 0.003 : 0.01);

/** Run one agent through the window. `yieldEvery` lets long runs give the event loop a breather. */
export async function backtest(series: BtSeries[], minutes: number, cfg: BtConfig, yieldEvery = 0): Promise<BtResult> {
  const deposit = cfg.deposit ?? 1000, minTrade = cfg.minTrade ?? 5, maxOrders = cfg.maxOrders ?? 4, t0 = cfg.t0 ?? 0;
  const FEE = BT_FEE;
  let cash = deposit;
  const qty: Record<string, number> = {}, entry: Record<string, number> = {}, peak: Record<string, number> = {};
  const entryAt: Record<string, number> = {}, cooldown: Record<string, number> = {};
  let learn: Learn | undefined;
  const byMint = new Map(series.map((s) => [s.mint, s]));
  const priceAt = (mint: string, m: number) => { const s = byMint.get(mint); if (!s || m < s.start) return 0; return s.p[Math.min(m - s.start, s.p.length - 1)]; };
  const equity: number[] = [], log: BtTrade[] = [];
  let lastReb = -1e9, fees = 0, expoSum = 0, closed = 0, wins = 0, peakEq = deposit, maxDD = 0;
  const hourly: number[] = [];

  for (let m = 0; m < minutes; m++) {
    if (yieldEvery && m % yieldEvery === 0) await new Promise((r) => setImmediate(r));
    const now = t0 + m * 60_000;
    const view: MarketAsset[] = [];
    for (const s of series) {
      if (m < s.start) continue;
      const end = Math.min(m - s.start + 1, s.p.length);
      view.push({ mint: s.mint, sym: s.sym, kind: s.kind, quoteMint: s.quoteMint ?? null, h: s.p.subarray(Math.max(0, end - HIST), end) as unknown as number[] });
    }
    const values: Record<string, number> = {};
    for (const [mt, q] of Object.entries(qty)) if (q > 0) values[mt] = q * priceAt(mt, m);
    // peaks / stale bookkeeping (mirrors the worker's updatePeaks)
    for (const mt of Object.keys(peak)) if (!(values[mt] > 1)) delete peak[mt];
    for (const mt of Object.keys(entryAt)) if (!(values[mt] > 1)) delete entryAt[mt];
    for (const [mt, v] of Object.entries(values)) if (v > 1) { const p = priceAt(mt, m); if (!peak[mt] || p > peak[mt]) peak[mt] = p; }
    for (const [mt, u] of Object.entries(cooldown)) if (u <= now) delete cooldown[mt];

    const agv = { strat: cfg.strat, risk: cfg.risk, uni: cfg.uni, values, cash, entry, peak, cooldown, entryAt, learn, engine: cfg.engine, now };
    let t: ReturnType<typeof computeTargets> | null = null;
    if (m - lastReb >= cfg.cadenceMin) t = computeTargets(agv, view);
    else if (Object.keys(values).length) {
      // risk exits are checked every minute
      if (riskExits(agv, view).length) t = computeTargets(agv, view);
    }
    if (t) {
      lastReb = m;
      const exitWhy = new Map(t.exits.map((x) => [x.mint, x.why]));
      for (const x of t.exits) cooldown[x.mint] = now + RISK_COOLDOWN_MS;
      const all = planOrders(values, cash, t, minTrade, 999);
      const orders = all.slice(0, maxOrders);
      if (all.length > orders.length) lastReb = m - cfg.cadenceMin + 2;
      else if (t.warming) lastReb = m - cfg.cadenceMin + 5;
      for (const o of orders) {
        const price = priceAt(o.mint, m);
        if (!price) continue;
        const k = byMint.get(o.mint)?.kind, slip = btSlip(k);
        if (o.side === "sell") {
          const heldQ = qty[o.mint] ?? 0, q = o.fraction >= 0.999 ? heldQ : heldQ * o.fraction;
          if (q <= 0) continue;
          const got = q * price * (1 - slip) * (1 - FEE);
          fees += q * price - got;
          qty[o.mint] = heldQ - q;
          if (qty[o.mint] * price < 0.01) {
            const e = entry[o.mint];
            if (e) {
              const r = (got * (1 - FEE)) / (q * e) - 1;
              closed++; if (r > 0) wins++;
              if (cfg.learn !== false && k) {
                const pk = peak[o.mint] ? peak[o.mint] / e - 1 : Math.max(0, r);
                learn = learnFrom(learn, { k, s: byMint.get(o.mint)!.sym, r, pk, why: exitWhy.get(o.mint) ?? "signal", min: entryAt[o.mint] ? Math.round((now - entryAt[o.mint]) / 60_000) : 0, t: now }).learn;
              }
            }
            delete qty[o.mint]; delete entry[o.mint];
          }
          cash += got;
          log.push({ m, mint: o.mint, side: "sell", usd: got, price });
        } else {
          const spend = Math.min(o.usd, cash);
          if (spend < minTrade) continue;
          const fill = price * (1 + slip), q = (spend * (1 - FEE)) / fill;
          fees += spend - q * price;
          const prev = qty[o.mint] ?? 0;
          entry[o.mint] = ((entry[o.mint] ?? fill) * prev + fill * q) / (prev + q);
          if (!(prev > 0)) entryAt[o.mint] = now;
          qty[o.mint] = prev + q;
          cash -= spend;
          log.push({ m, mint: o.mint, side: "buy", usd: spend, price: fill });
        }
      }
    }
    let invested = 0;
    for (const [mt, q] of Object.entries(qty)) invested += q * priceAt(mt, m);
    const eq = cash + invested;
    expoSum += eq > 0 ? invested / eq : 0;
    if (m % 5 === 0) equity.push(eq);
    if (m % 60 === 0) hourly.push(eq);
    if (eq > peakEq) peakEq = eq;
    maxDD = Math.max(maxDD, 1 - eq / peakEq);
  }
  let final = cash;
  for (const [mt, q] of Object.entries(qty)) final += q * priceAt(mt, minutes - 1);
  const rets: number[] = [];
  for (let i = 1; i < hourly.length; i++) rets.push(hourly[i] / hourly[i - 1] - 1);
  const mu = rets.reduce((s, x) => s + x, 0) / Math.max(1, rets.length);
  const sd = Math.sqrt(rets.reduce((s, x) => s + (x - mu) ** 2, 0) / Math.max(1, rets.length));
  return {
    strat: cfg.strat, engine: cfg.engine, minutes, ret: final / deposit - 1, maxDD,
    sharpe: sd > 0 ? (mu / sd) * Math.sqrt(24 * 365) : 0, trades: log.length, closed, winRate: closed ? wins / closed : 0,
    fees, avgExposure: expoSum / Math.max(1, minutes), equity, log, learn,
  };
}

/**
 * Lookahead test: scramble every price after minute `k` and check the agent made exactly the same trades up to `k`.
 * If a strategy peeked at the future, its earlier decisions would change.
 */
export async function lookaheadCheck(series: BtSeries[], minutes: number, cfg: BtConfig, k = Math.floor(minutes / 2)): Promise<boolean> {
  const a = await backtest(series, k, cfg);
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const scrambled = series.map((s) => {
    const p = Float64Array.from(s.p);
    for (let i = Math.max(0, k - s.start); i < p.length; i++) p[i] = p[i] * (0.5 + rnd());
    return { ...s, p };
  });
  const b = await backtest(scrambled, minutes, cfg);
  const before = b.log.filter((x) => x.m < k);
  return before.length === a.log.length && before.every((x, i) => x.mint === a.log[i].mint && x.side === a.log[i].side && Math.abs(x.usd - a.log[i].usd) < 1e-6);
}

/** Build aligned, forward-filled minute series from raw (mint, minute, price) ticks. */
export function buildSeries(meta: { mint: string; sym: string; kind: AssetKind; quoteMint?: string | null }[], ticks: { mint: string; m: number; price: number }[], minutes: number): BtSeries[] {
  const by = new Map<string, { m: number; price: number }[]>();
  for (const t of ticks) { const a = by.get(t.mint) ?? []; a.push(t); by.set(t.mint, a); }
  const out: BtSeries[] = [];
  for (const a of meta) {
    const ts = (by.get(a.mint) ?? []).sort((x, y) => x.m - y.m);
    if (ts.length < 60) continue;
    const start = ts[0].m, p = new Float64Array(minutes - start);
    let j = 0, cur = ts[0].price;
    for (let m = start; m < minutes; m++) {
      while (j < ts.length && ts[j].m <= m) { if (ts[j].price > 0) cur = ts[j].price; j++; }
      p[m - start] = cur;
    }
    out.push({ ...a, start, p });
  }
  return out;
}
