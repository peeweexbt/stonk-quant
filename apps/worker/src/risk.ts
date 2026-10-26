import { RISK_COOLDOWN_MS, learnFrom, riskExits, type AgentView, type AssetKind, type ExitWhy, type Learn, type MarketAsset } from "@stonkquant/core";

export interface RiskState { entry: Record<string, number>; peak?: Record<string, number>; cooldown?: Record<string, number>; entryAt?: Record<string, number>; learn?: Learn }

/** Track the high-water mark of each held position and drop stale cooldowns. Returns true if anything changed. */
export function updatePeaks(state: RiskState, values: Record<string, number>, priceOf: (m: string) => number | undefined): boolean {
  const peak = (state.peak ??= {});
  let changed = false;
  for (const m of Object.keys(peak)) if (!(values[m] > 1)) { delete peak[m]; changed = true; }
  for (const m of Object.keys(state.entryAt ?? {})) if (!(values[m] > 1)) { delete state.entryAt![m]; changed = true; }
  for (const [m, v] of Object.entries(values)) {
    if (!(v > 1)) continue;
    const p = priceOf(m);
    if (p && (!peak[m] || p > peak[m])) { peak[m] = p; changed = true; }
  }
  const now = Date.now();
  for (const [m, until] of Object.entries(state.cooldown ?? {})) if (until <= now) { delete state.cooldown![m]; changed = true; }
  return changed;
}

export function needsRiskExit(view: AgentView, market: MarketAsset[]) {
  return riskExits(view, market).length > 0;
}

export function startCooldowns(state: RiskState, mints: string[]) {
  const cd = (state.cooldown ??= {});
  for (const m of mints) cd[m] = Date.now() + RISK_COOLDOWN_MS;
}

/**
 * A position was fully closed: feed the result into the agent's learner.
 * Call BEFORE the entry price is deleted. `r` is the realised return after fees and slippage.
 * Returns a human-readable note when the learned parameters moved, else null.
 */
export function learnClose(state: RiskState, mint: string, kind: AssetKind | undefined, sym: string, r: number, why: ExitWhy): string | null {
  if (!kind || !Number.isFinite(r)) return null;
  const e = state.entry[mint];
  const pk = e && state.peak?.[mint] ? state.peak[mint] / e - 1 : Math.max(0, r);
  const at = state.entryAt?.[mint];
  const { learn, change } = learnFrom(state.learn, { k: kind, s: sym, r, pk, why, min: at ? Math.round((Date.now() - at) / 60_000) : 0, t: Date.now() });
  state.learn = learn;
  return change;
}
