// Re-scores every strategy on the last 7 days of real minute prices, old engine (v1) vs new (v2),
// using the sims' presets. Results are stored in settings('backtest') and served at /api/backtest.
import { STRATS, backtest, buildSeries, lookaheadCheck, type AssetKind, type StratKey } from "@stonkquant/core";
import { sql } from "./db";
import { SIM_PROFILE } from "./paper";

export interface BacktestSummary {
  at: string; days: number; assets: number;
  results: { strat: StratKey; v1: Metrics; v2: Metrics }[];
  lookaheadOk: boolean;
}
interface Metrics { ret: number; maxDD: number; sharpe: number; trades: number; winRate: number; fees: number; avgExposure: number; equity: number[] }

const round = (x: number, d = 5) => Math.round(x * 10 ** d) / 10 ** d;

export async function loadHistory(days = 7) {
  const meta = await sql<{ mint: string; sym: string; kind: AssetKind; quote_mint: string | null }[]>`SELECT mint, sym, kind, quote_mint FROM assets`;
  const ticks = await sql<{ mint: string; m: number; price: number }[]>`
    SELECT mint, (extract(epoch FROM ts) / 60)::bigint AS m, price FROM price_ticks WHERE ts > now() - make_interval(days => ${days}) ORDER BY ts ASC`;
  if (!ticks.length) return null;
  const m0 = Number(ticks[0].m);
  const minutes = Number(ticks[ticks.length - 1].m) - m0 + 1;
  const series = buildSeries(meta.map((a) => ({ mint: a.mint, sym: a.sym, kind: a.kind, quoteMint: a.quote_mint })), ticks.map((t) => ({ mint: t.mint, m: Number(t.m) - m0, price: t.price })), minutes);
  return { series, minutes, t0: m0 * 60_000 };
}

export async function runBacktests(): Promise<BacktestSummary | null> {
  const h = await loadHistory(7);
  if (!h || h.minutes < 600) return null;
  const results: BacktestSummary["results"] = [];
  let lookaheadOk = true;
  for (const strat of Object.keys(SIM_PROFILE) as StratKey[]) {
    const p = SIM_PROFILE[strat];
    const cfg = { strat, risk: p.risk, uni: p.uni, cadenceMin: Math.max(1, Math.round(STRATS[strat].cad * p.cad)), t0: h.t0 };
    const pick = async (engine: "v1" | "v2"): Promise<Metrics> => {
      const r = await backtest(h.series, h.minutes, { ...cfg, engine }, 500);
      const step = Math.max(1, Math.ceil(r.equity.length / 120));
      return { ret: round(r.ret), maxDD: round(r.maxDD), sharpe: round(r.sharpe, 2), trades: r.trades, winRate: round(r.winRate, 3), fees: round(r.fees, 2), avgExposure: round(r.avgExposure, 3), equity: r.equity.filter((_, i) => i % step === 0).map((x) => round(x, 2)) };
    };
    results.push({ strat, v1: await pick("v1"), v2: await pick("v2") });
  }
  // spot-check that the v2 engine never uses future prices
  lookaheadOk = await lookaheadCheck(h.series, Math.min(h.minutes, 2000), { strat: "MOMENTUM", risk: 4, uni: ["xstock", "prestock", "stonk"], cadenceMin: 90, engine: "v2", t0: h.t0 });
  const summary: BacktestSummary = { at: new Date().toISOString(), days: round(h.minutes / 1440, 2), assets: h.series.length, results, lookaheadOk };
  await sql`INSERT INTO settings (k, v) VALUES ('backtest', ${JSON.stringify(summary)}) ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v, updated_at = now()`;
  return summary;
}

export function printSummary(s: BacktestSummary) {
  const f = (x: number) => (x >= 0 ? "+" : "") + (x * 100).toFixed(2) + "%";
  console.log(`[backtest] ${s.days} days, ${s.assets} assets, lookahead check ${s.lookaheadOk ? "passed" : "FAILED"}`);
  for (const r of s.results) {
    console.log(`[backtest] ${r.strat.padEnd(9)} v1 ${f(r.v1.ret).padStart(8)} dd ${f(-r.v1.maxDD).padStart(7)} ${String(r.v1.trades).padStart(4)} trades | v2 ${f(r.v2.ret).padStart(8)} dd ${f(-r.v2.maxDD).padStart(7)} ${String(r.v2.trades).padStart(4)} trades`);
  }
}
