import { CURATED_ASSETS, SCHEMA_SQL, STONK_MINT } from "@stonkquant/core";
import { sql } from "./db";

export async function migrate() {
  await sql.unsafe(SCHEMA_SQL);
  for (const a of CURATED_ASSETS) {
    await sql`
      INSERT INTO assets (mint, sym, name, kind, decimals, active)
      VALUES (${a.mint}, ${a.sym}, ${a.name}, ${a.kind}, ${a.decimals}, true)
      ON CONFLICT (mint) DO UPDATE SET sym = EXCLUDED.sym, name = EXCLUDED.name, kind = EXCLUDED.kind, decimals = EXCLUDED.decimals, active = true, updated_at = now()`;
  }
  // Universe moved to Float: retire the old stonk.fun token, and point agents' legacy coin sources at Float coins.
  await sql`UPDATE assets SET active = false, updated_at = now() WHERE mint = ${STONK_MINT} AND active`;
  await sql`UPDATE agents SET uni = (SELECT array_agg(DISTINCT CASE WHEN k IN ('pair', 'pump', 'otc') THEN 'float' ELSE k END) FROM unnest(uni) AS k)
    WHERE uni && ARRAY['pair', 'pump', 'otc']::text[]`;
  // One-time: hide the team's own agents from the public floor, feed and totals (they keep trading).
  const [done] = await sql<{ v: string }[]>`SELECT v FROM settings WHERE k = 'hide_v1'`;
  if (!done) {
    await sql`UPDATE agents SET hidden = true WHERE NOT sim AND status <> 'retired' AND upper(name) IN ('GAMMA-97', 'VWAP-3-62')`;
    await sql`INSERT INTO settings (k, v) VALUES ('hide_v1', 'done') ON CONFLICT (k) DO NOTHING`;
  }
}

// Allow `npm run migrate`
if (import.meta.url === `file://${process.argv[1]}`) {
  migrate()
    .then(() => { console.log("schema ready"); return sql.end(); })
    .catch((e) => { console.error(e); process.exit(1); });
}
