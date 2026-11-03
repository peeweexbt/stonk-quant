// Quant toolkit for the v2 engine: factors, market regime, and portfolio sizing.
// Ideas adapted from open factor research (momentum with skip, 52-week-high proximity, short-term reversal,
// low-volatility, Kaufman efficiency ratio) and from risk-parity / equal-volatility portfolio construction.
// Everything here is pure, deterministic and only looks at the history it is given (no lookahead).
import type { MarketAsset } from "./strategies";

type H = ArrayLike<number>;
const L = (h: H) => h.length;
const lastOf = (h: H) => h[h.length - 1];

/** Return over the last n minutes. */
export function retN(h: H, n: number) {
  if (L(h) <= n) return 0;
  const p0 = h[L(h) - 1 - n];
  return p0 > 0 ? lastOf(h) / p0 - 1 : 0;
}

/** Momentum over n minutes, skipping the most recent `skip` minutes (avoids short-term reversal noise). */
export function momSkip(h: H, n: number, skip: number) {
  if (L(h) <= n) return 0;
  const a = h[L(h) - 1 - n], b = h[L(h) - 1 - skip];
  return a > 0 ? b / a - 1 : 0;
}

/** How far price sits below its n-minute high (0 = at the high, -0.1 = 10% below). */
export function fromHigh(h: H, n: number) {
  const s = Math.max(0, L(h) - n);
  let mx = 0;
  for (let i = s; i < L(h); i++) if (h[i] > mx) mx = h[i];
  return mx > 0 ? lastOf(h) / mx - 1 : 0;
}

/** Standard deviation of one-minute log returns over the last n minutes. */
export function vol(h: H, n: number) {
  const s = Math.max(1, L(h) - n);
  let sum = 0, sq = 0, k = 0;
  for (let i = s; i < L(h); i++) {
    if (!(h[i - 1] > 0 && h[i] > 0)) continue;
    const r = Math.log(h[i] / h[i - 1]);
    sum += r; sq += r * r; k++;
  }
  if (k < 2) return 1e-6;
  const m = sum / k;
  return Math.sqrt(Math.max(0, sq / k - m * m)) || 1e-6;
}

/** Kaufman efficiency ratio: 1 = straight-line trend, ~0 = pure chop. */
export function effRatio(h: H, n: number) {
  if (L(h) <= n) return 0;
  const s = L(h) - 1 - n;
  let path = 0;
  for (let i = s + 1; i < L(h); i++) path += Math.abs(h[i] - h[i - 1]);
  return path > 0 ? Math.abs(lastOf(h) - h[s]) / path : 0;
}

export function smaN(h: H, n: number) {
  const s = Math.max(0, L(h) - n);
  let sum = 0;
  for (let i = s; i < L(h); i++) sum += h[i];
  return sum / Math.max(1, L(h) - s);
}

/** Price deviation from its n-minute mean, in units of the move one would expect over n minutes. */
export function devZ(h: H, n: number) {
  return (lastOf(h) / smaN(h, n) - 1) / (vol(h, n) * Math.sqrt(n));
}

/** Correlation of one-minute log returns over the last n minutes (aligned on the most recent minute). */
export function corr(a: H, b: H, n: number) {
  const k = Math.min(n, L(a) - 1, L(b) - 1);
  if (k < 20) return 0;
  let sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0, c = 0;
  for (let i = 0; i < k; i++) {
    const ia = L(a) - 1 - i, ib = L(b) - 1 - i;
    if (!(a[ia - 1] > 0 && b[ib - 1] > 0)) continue;
    const x = Math.log(a[ia] / a[ia - 1]), y = Math.log(b[ib] / b[ib - 1]);
    sa += x; sb += y; saa += x * x; sbb += y * y; sab += x * y; c++;
  }
  if (c < 20) return 0;
  const cov = sab / c - (sa / c) * (sb / c), va = saa / c - (sa / c) ** 2, vb = sbb / c - (sb / c) ** 2;
  return va > 0 && vb > 0 ? cov / Math.sqrt(va * vb) : 0;
}

/** Cross-sectional z-scores, winsorised at ±3. */
export function zs(vals: number[]) {
  if (vals.length < 2) return vals.map(() => 0);
  const m = vals.reduce((s, x) => s + x, 0) / vals.length;
  const sd = Math.sqrt(vals.reduce((s, x) => s + (x - m) ** 2, 0) / vals.length) || 1;
  return vals.map((x) => Math.max(-3, Math.min(3, (x - m) / sd)));
}

/* ---------------- market regime ---------------- */

export type RegimeKind = "up" | "down" | "chop" | "calm" | "neutral";
export interface Regime { kind: RegimeKind; trend: number; er: number; vol: number; note: string }

const SPY = "XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W";

/**
 * Classifies the broad market from SPYx (or an equal-weight xStock basket if SPYx is missing):
 * up = steady uptrend, down = falling below its 4h mean, chop = directionless, calm = barely moving (e.g. market closed).
 */
export function marketRegime(market: MarketAsset[]): Regime {
  let h: H | null = null;
  const spy = market.find((a) => a.mint === SPY);
  if (spy && L(spy.h) >= 240) h = spy.h;
  else {
    const xs = market.filter((a) => a.kind === "xstock" && L(a.h) >= 240);
    if (xs.length) {
      const n = Math.min(...xs.map((a) => L(a.h)));
      const idx: number[] = [];
      for (let i = 0; i < n; i++) {
        let s = 0;
        for (const a of xs) { const hh = a.h, off = L(hh) - n; s += hh[off + i] / hh[off]; }
        idx.push(s / xs.length);
      }
      h = idx;
    }
  }
  if (!h) return { kind: "neutral", trend: 0, er: 0, vol: 0, note: "regime: warming up" };
  const trend = retN(h, 240), er = effRatio(h, 120), v = vol(h, 120);
  let kind: RegimeKind = "neutral";
  if (v < 0.00005) kind = "calm";
  else if (trend < -0.004 && lastOf(h) < smaN(h, 240)) kind = "down";
  else if (trend > 0.003 && lastOf(h) > smaN(h, 240) && er > 0.3) kind = "up";
  else if (er < 0.2) kind = "chop";
  const pct = (x: number) => (x >= 0 ? "+" : "") + (x * 100).toFixed(2) + "%";
  return { kind, trend, er, vol: v, note: `regime ${kind} (SPYx 4h ${pct(trend)}, trend quality ${er.toFixed(2)})` };
}

/* ---------------- sizing ---------------- */

/** Weights proportional to 1/volatility (equal-risk contribution if assets were uncorrelated). */
export function invVol(assets: MarketAsset[], n = 120): Record<string, number> {
  const w: Record<string, number> = {};
  for (const a of assets) w[a.mint] = 1 / Math.max(vol(a.h, n), 1e-5);
  return w;
}

/**
 * Naive risk parity: iteratively scale weights so each asset contributes similar risk,
 * accounting for correlation. Falls back to inverse-vol on thin history.
 */
export function riskParity(assets: MarketAsset[], n = 240, iters = 30): Record<string, number> {
  const k = assets.length;
  if (k < 2) return invVol(assets, n);
  const sd = assets.map((a) => vol(a.h, n));
  const C: number[][] = assets.map((a, i) => assets.map((b, j) => (i === j ? 1 : corr(a.h, b.h, n))));
  let w = sd.map((s) => 1 / Math.max(s, 1e-5));
  const norm = (x: number[]) => { const t = x.reduce((s, y) => s + y, 0) || 1; return x.map((y) => y / t); };
  w = norm(w);
  for (let it = 0; it < iters; it++) {
    const mrc = w.map((_, i) => sd[i] * w.reduce((s, wj, j) => s + C[i][j] * sd[j] * wj, 0));
    w = norm(w.map((wi, i) => wi / Math.max(Math.sqrt(Math.max(mrc[i] * wi, 1e-18)), 1e-9) * Math.sqrt(1 / k)));
  }
  const out: Record<string, number> = {};
  assets.forEach((a, i) => (out[a.mint] = w[i]));
  return out;
}

/** Greedy: keep candidates in score order, skipping any that move almost in lock-step with one already kept. */
export function dropCorrelated<T extends { a: MarketAsset }>(ranked: T[], max = 0.85, n = 240): T[] {
  const kept: T[] = [];
  for (const c of ranked) if (!kept.some((k) => corr(k.a.h, c.a.h, n) > max)) kept.push(c);
  return kept;
}

/** Normalise raw weights so they sum to `total`. */
export function scaleTo(raw: Record<string, number>, total: number): Record<string, number> {
  const s = Object.values(raw).reduce((x, y) => x + y, 0);
  const out: Record<string, number> = {};
  if (s > 0) for (const k in raw) out[k] = (raw[k] / s) * total;
  return out;
}
