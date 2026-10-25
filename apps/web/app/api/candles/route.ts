import { db } from "@/lib/db";
import { fail, json } from "@/lib/auth";
import { isPubkey } from "@/lib/solana";

export const dynamic = "force-dynamic";

/** Last ~3 hours of one-minute prices for the ASCII chart. */
export async function GET(req: Request) {
  const mint = new URL(req.url).searchParams.get("mint");
  if (!isPubkey(mint)) return fail("bad mint");
  const sql = db();
  const rows = await sql<{ ts: string; price: number }[]>`
    SELECT ts, price FROM (SELECT ts, price FROM price_ticks WHERE mint = ${mint} ORDER BY ts DESC LIMIT 180) t ORDER BY ts ASC`;
  return json({ mint, points: rows.map((r) => r.price), from: rows[0]?.ts ?? null }, 200, { "cache-control": "public, s-maxage=20, stale-while-revalidate=40" });
}
