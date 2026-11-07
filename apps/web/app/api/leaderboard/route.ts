import { learnStats, type Learn } from "@stonkquant/core";
import { db } from "@/lib/db";
import { json } from "@/lib/auth";

export const dynamic = "force-dynamic";

const WINDOWS: Record<string, string> = { "24h": "24 hours", "7d": "7 days", all: "3650 days" };

/**
 * Agents ranked by return over a window. Return adjusts for deposits made inside the window,
 * so topping up doesn't look like profit. Hidden agents are excluded.
 */
export async function GET(req: Request) {
  try {
    const w = new URL(req.url).searchParams.get("window") ?? "7d";
    const interval = WINDOWS[w] ?? WINDOWS["7d"];
    const sql = db();
    const rows = await sql<any[]>`
      SELECT a.id, a.name, a.strat, a.risk, a.cadence_mul, a.uni, a.color, a.sim, a.status, a.equity_usd, a.deposited_usd, a.withdrawn_usd,
             a.trades, a.created_at, a.state->'learn' AS learn,
             (SELECT equity FROM agent_equity e WHERE e.agent_id = a.id AND e.ts >= now() - ${interval}::interval ORDER BY e.ts ASC LIMIT 1) AS eq0,
             (SELECT coalesce(sum(usdc), 0) FROM deposits d WHERE d.agent_id = a.id AND d.ts >= now() - ${interval}::interval)::float8 AS dep_win
      FROM agents a WHERE NOT a.hidden AND a.status IN ('live', 'paused')`;
    const ids = rows.map((r) => r.id as number);
    const curves = new Map<number, number[]>();
    if (ids.length) {
      const eq = await sql<{ agent_id: number; equity: number }[]>`
        SELECT agent_id, equity FROM agent_equity WHERE agent_id = ANY(${ids}) AND ts >= now() - ${interval}::interval ORDER BY ts ASC`;
      for (const r of eq) { const a = curves.get(r.agent_id) ?? []; a.push(r.equity); curves.set(r.agent_id, a); }
    }
    const out = rows.map((r) => {
      const base = r.deposited_usd - r.withdrawn_usd;
      let ret: number | null;
      if (w === "all") ret = base > 0 ? r.equity_usd / base - 1 : null;
      else ret = r.eq0 > 0 ? r.equity_usd / (r.eq0 + (r.dep_win ?? 0)) - 1 : null;
      const curve = [...(curves.get(r.id) ?? []), r.equity_usd];
      let peak = 0, dd = 0;
      for (const v of curve) { if (v > peak) peak = v; if (peak > 0) dd = Math.max(dd, 1 - v / peak); }
      const L = r.learn as Learn | null;
      const st = L?.recent?.length ? learnStats(L.recent) : null;
      const step = Math.max(1, Math.ceil(curve.length / 40));
      return {
        id: r.id, name: r.name, strat: r.strat, risk: r.risk, cadence: r.cadence_mul, uni: r.uni, color: r.color, sim: r.sim, status: r.status,
        equity: r.equity_usd, ret, maxDD: dd, trades: r.trades, winRate: st ? st.winRate : null, closed: L?.n ?? 0, since: r.created_at,
        spark: curve.filter((_, i) => i % step === 0 || i === curve.length - 1),
      };
    }).sort((a, b) => (b.ret ?? -9) - (a.ret ?? -9));
    return json({ window: w, rows: out }, 200, { "cache-control": "public, s-maxage=60, stale-while-revalidate=120" });
  } catch (e) {
    return json({ error: (e as Error).message }, 500, { "cache-control": "no-store" });
  }
}
