// Tries the database URL with and without SSL. Usage: DB="postgresql://..." npx tsx apps/worker/scripts/dbcheck.ts
import postgres from "postgres";
const url = process.env.DB || process.env.DATABASE_URL;
if (!url) { console.log("set DB=..."); process.exit(1); }
for (const ssl of ["require", false] as const) {
  const sql = postgres(url.replace(/[?&]sslmode=[^&]*/, ""), { ssl, connect_timeout: 8, max: 1 });
  try {
    const r = await sql`select version(), (select count(*) from assets) as assets`;
    console.log(`ssl=${ssl}: OK  ${String(r[0].version).slice(0, 30)}…  assets=${r[0].assets}`);
  } catch (e) { console.log(`ssl=${ssl}: FAIL ${(e as Error).message}`); }
  await sql.end({ timeout: 2 }).catch(() => {});
}
