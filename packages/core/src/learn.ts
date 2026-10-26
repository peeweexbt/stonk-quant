// Per-agent learning: every agent tunes a few bounded knobs from its own closed trades.
// It never invents new strategies; it only adjusts how strict entries are, how wide stops/trails are,
// and how much it sizes each asset type. Small steps, hard bounds, and nothing changes before LEARN_MIN trades.
import type { AssetKind } from "./assets";
import { RISK_RULES } from "./strategies";

export type ExitWhy = "stop" | "trail" | "signal";

export interface ClosedTrade {
  /** asset kind */ k: AssetKind;
  /** symbol (display only) */ s: string;
  /** realised return after fees and slippage */ r: number;
  /** best unrealised return while held */ pk: number;
  why: ExitWhy;
  /** minutes held */ min: number;
  t: number;
}

export interface Learn {
  /** closed trades learned from, lifetime */
  n: number;
  /** most recent closed trades (sliding window) */
  recent: ClosedTrade[];
  /** entry threshold multiplier: >1 = pickier entries */
  entry: number;
  /** stop-loss distance multiplier */
  stop: number;
  /** trailing give-back multiplier: >1 = lets winners run further */
  trail: number;
  /** position-size multiplier per asset type */
  kind: Partial<Record<AssetKind, number>>;
  /** last adjustment, human readable */
  last?: string;
  at?: number;
}

export const LEARN_MIN = 8;
export const LEARN_WINDOW = 30;
const RATE = 0.3;
export const LEARN_BOUNDS = { entry: [0.8, 1.6], stop: [0.7, 1.4], trail: [0.6, 1.5], kind: [0.5, 1.5] } as const;

export const freshLearn = (): Learn => ({ n: 0, recent: [], entry: 1, stop: 1, trail: 1, kind: {} });

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
const mean = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
const r3 = (x: number) => Math.round(x * 1000) / 1000;

export function learnStats(recent: ClosedTrade[]) {
  const wins = recent.filter((c) => c.r > 0);
  const losses = recent.filter((c) => c.r <= 0);
  return {
    count: recent.length,
    winRate: recent.length ? wins.length / recent.length : 0,
    avgWin: mean(wins.map((c) => c.r)),
    avgLoss: Math.abs(mean(losses.map((c) => c.r))),
    expectancy: mean(recent.map((c) => c.r)),
    stopRate: recent.length ? recent.filter((c) => c.why === "stop").length / recent.length : 0,
  };
}

/** Fold one closed trade into the agent's learned parameters. */
export function learnFrom(prev: Learn | undefined, c: ClosedTrade): { learn: Learn; change: string | null } {
  const base = prev ?? freshLearn();
  const L: Learn = { ...base, kind: { ...base.kind }, recent: [...base.recent, c].slice(-LEARN_WINDOW), n: base.n + 1 };
  if (L.recent.length < LEARN_MIN) return { learn: L, change: null };

  const st = learnStats(L.recent);
  const step = (cur: number, target: number, [lo, hi]: readonly [number, number]) => r3(clamp(cur + RATE * (target - cur), lo, hi));

  // 1. Entry strictness follows the hit rate: losing more often than winning → demand stronger signals.
  L.entry = step(L.entry, 1 + (0.5 - st.winRate) * 1.6, LEARN_BOUNDS.entry);

  // 2. Stops: if losers cost more than winners pay, cut them sooner.
  //    If stops fire a lot but the trades that survive pay well, the stop is shaking out good trades: give room.
  const payoff = st.avgLoss > 0 ? st.avgWin / st.avgLoss : 2;
  const stopT = payoff < 0.8 ? 0.8 : st.stopRate > 0.4 && payoff >= 1.2 ? 1.25 : 1;
  L.stop = step(L.stop, stopT, LEARN_BOUNDS.stop);

  // 3. Trailing exit: how much of their best gain did trades hand back?
  // only trades that got near their take-profit arm level say anything about the trail
  const ran = L.recent.filter((x) => x.pk >= RISK_RULES[x.k].arm * 0.5);
  if (ran.length >= 4) {
    const giveback = mean(ran.map((x) => clamp((x.pk - x.r) / x.pk, 0, 1.5)));
    L.trail = step(L.trail, giveback > 0.6 ? 0.75 : giveback < 0.3 ? 1.25 : 1, LEARN_BOUNDS.trail);
  }

  // 4. Sizing per asset type, scaled by how volatile that type is and shrunk toward 1 on thin samples.
  const kinds = new Set(L.recent.map((x) => x.k));
  for (const k of kinds) {
    const rs = L.recent.filter((x) => x.k === k).map((x) => x.r);
    if (rs.length < 4) continue;
    const conf = rs.length / (rs.length + 6);
    const target = 1 + conf * clamp((mean(rs) / RISK_RULES[k].stop) * 2, -0.5, 0.5);
    L.kind[k] = step(L.kind[k] ?? 1, target, LEARN_BOUNDS.kind);
  }

  const diffs: string[] = [];
  const d = (label: string, a: number, b: number) => { if (Math.abs(b - a) >= 0.02) diffs.push(`${label} ×${b.toFixed(2)}`); };
  d("entry strictness", base.entry, L.entry);
  d("stop width", base.stop, L.stop);
  d("trail room", base.trail, L.trail);
  for (const k of kinds) d(`${k} size`, base.kind[k] ?? 1, L.kind[k] ?? 1);
  const change = diffs.length
    ? `learned from last ${st.count} trades (${Math.round(st.winRate * 100)}% wins, avg ${st.expectancy >= 0 ? "+" : ""}${(st.expectancy * 100).toFixed(1)}%): ${diffs.join(", ")}`
    : null;
  if (change) { L.last = change; L.at = c.t; }
  return { learn: L, change };
}
