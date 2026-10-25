import { RISK_COOLDOWN_MS, riskExits, type AgentView, type MarketAsset } from "@stonkquant/core";

export interface RiskState { entry: Record<string, number>; peak?: Record<string, number>; cooldown?: Record<string, number>; entryAt?: Record<string, number> }

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
