import { CURATED_ASSETS, SCHEMA_SQL } from "@stonkquant/core";
import { sql } from "./db";

export async function migrate() {
  await sql.unsafe(SCHEMA_SQL);
  for (const a of CURATED_ASSETS) {
    await sql`
      INSERT INTO assets (mint, sym, name, kind, decimals, active)
      VALUES (${a.mint}, ${a.sym}, ${a.name}, ${a.kind}, ${a.decimals}, true)
      ON CONFLICT (mint) DO UPDATE SET sym = EXCLUDED.sym, name = EXCLUDED.name, kind = EXCLUDED.kind, decimals = EXCLUDED.decimals, active = true, updated_at = now()`;
  }
}

// Allow `npm run migrate`
if (import.meta.url === `file://${process.argv[1]}`) {
  migrate()
    .then(() => { console.log("schema ready"); return sql.end(); })
    .catch((e) => { console.error(e); process.exit(1); });
}
