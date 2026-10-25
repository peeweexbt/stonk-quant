import postgres from "postgres";

declare global {
  // eslint-disable-next-line no-var
  var __sq_sql: ReturnType<typeof postgres> | undefined;
}

/** Lazily created so `next build` works without a database. */
export function db() {
  if (globalThis.__sq_sql) return globalThis.__sq_sql;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  globalThis.__sq_sql = postgres(url, {
    max: 3,
    idle_timeout: 20,
    connect_timeout: 8,
    prepare: false,
    ssl: url.includes("localhost") || url.includes("railway.internal") ? false : "require",
  });
  return globalThis.__sq_sql;
}
