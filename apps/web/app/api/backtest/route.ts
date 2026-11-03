import { db } from "@/lib/db";
import { json } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** Latest v1-vs-v2 backtest on the last 7 days of real prices (computed by the worker every few hours). */
export async function GET() {
  try {
    const [row] = await db()<{ v: string; updated_at: string }[]>`SELECT v, updated_at FROM settings WHERE k = 'backtest'`;
    return json(row ? JSON.parse(row.v) : { pending: true }, 200, { "cache-control": "public, s-maxage=300, stale-while-revalidate=600" });
  } catch (e) {
    return json({ error: (e as Error).message }, 500, { "cache-control": "no-store" });
  }
}
