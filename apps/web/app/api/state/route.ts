import { db } from "@/lib/db";
import { json } from "@/lib/auth";

export const dynamic = "force-dynamic";

type Tick = { mint: string; price: number };

function downsample(arr: number[], n: number) {
  if (arr.length <= n) return arr;
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(arr[Math.floor((i / (n - 1)) * (arr.length - 1))]);
  return out;
}

export async function GET() {
  const sql = db();
  const [assets, ticks, agents, feed, totals] = await Promise.all([
    sql<{ mint: string; sym: string; name: string; kind: string; quote_sym: string | null; logo: string | null; mcap_usd: number | null }[]>`
      SELECT mint, sym, name, kind, quote_sym, logo, mcap_usd FROM assets WHERE active ORDER BY
        CASE kind WHEN 'xstock' THEN 0 WHEN 'prestock' THEN 1 WHEN 'stonk' THEN 2 ELSE 3 END, mcap_usd DESC NULLS LAST, sym`,
    sql<Tick[]>`SELECT mint, price FROM price_ticks WHERE ts > now() - interval '61 minutes' ORDER BY ts ASC`,
    sql<any[]>`
      SELECT id, owner, name, strat, risk, color, status, address, deposited_usd, withdrawn_usd, equity_usd, cash_usd, sol_balance,
             holdings, note, trades, volume_usd, created_at, last_rebalance_at
      FROM agents WHERE status <> 'retired' ORDER BY (status = 'live') DESC, equity_usd DESC, id DESC LIMIT 60`,
    sql<any[]>`
      SELECT e.id, e.ts, e.type, e.text, e.sig, a.id AS agent_id, a.name, a.color
      FROM agent_events e JOIN agents a ON a.id = e.agent_id
      WHERE e.type <> 'think' ORDER BY e.ts DESC LIMIT 60`,
    sql<any[]>`
      SELECT
        count(*) FILTER (WHERE status = 'live')::int AS live,
        count(*) FILTER (WHERE status <> 'retired')::int AS active,
        coalesce(sum(equity_usd) FILTER (WHERE status <> 'retired'), 0)::float8 AS aum,
        coalesce(sum(deposited_usd - withdrawn_usd) FILTER (WHERE status <> 'retired'), 0)::float8 AS net_deposits,
        coalesce(sum(trades), 0)::int AS trades,
        coalesce(sum(volume_usd), 0)::float8 AS volume
      FROM agents`,
  ]);

  const hist = new Map<string, number[]>();
  for (const t of ticks) {
    const h = hist.get(t.mint) ?? [];
    h.push(t.price);
    hist.set(t.mint, h);
  }
  const markets = assets
    .map((a) => {
      const h = hist.get(a.mint) ?? [];
      const price = h.length ? h[h.length - 1] : null;
      const ch1h = h.length > 1 ? h[h.length - 1] / h[0] - 1 : 0;
      return { ...a, price, ch1h, spark: downsample(h, 20) };
    })
    .filter((m) => m.price !== null);

  const ids = agents.map((a) => a.id as number);
  let sparks = new Map<number, number[]>();
  let thoughts = new Map<number, { type: string; text: string; ts: string }>();
  if (ids.length) {
    const [eq, last] = await Promise.all([
      sql<{ agent_id: number; equity: number }[]>`
        SELECT agent_id, equity FROM agent_equity WHERE agent_id = ANY(${ids}) AND ts > now() - interval '24 hours' ORDER BY ts ASC`,
      sql<{ agent_id: number; type: string; text: string; ts: string }[]>`
        SELECT DISTINCT ON (agent_id) agent_id, type, text, ts FROM agent_events WHERE agent_id = ANY(${ids}) ORDER BY agent_id, ts DESC`,
    ]);
    for (const r of eq) { const a = sparks.get(r.agent_id) ?? []; a.push(r.equity); sparks.set(r.agent_id, a); }
    sparks = new Map([...sparks].map(([k, v]) => [k, downsample(v, 60)]));
    thoughts = new Map(last.map((r) => [r.agent_id, r]));
  }

  const out = agents.map((a) => ({
    ...a,
    spark: sparks.get(a.id) ?? [],
    last: thoughts.get(a.id) ?? null,
  }));

  const t = totals[0];
  return json(
    {
      now: new Date().toISOString(),
      markets,
      agents: out,
      feed,
      stats: { live: t.live, active: t.active, aum: t.aum, pnl: t.aum - t.net_deposits, trades: t.trades, volume: t.volume, assets: markets.length },
    },
    200,
    { "cache-control": "public, s-maxage=5, stale-while-revalidate=10" },
  );
}
