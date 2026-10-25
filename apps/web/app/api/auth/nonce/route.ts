import { randomUUID } from "crypto";
import { db } from "@/lib/db";
import { fail, json } from "@/lib/auth";
import { isPubkey } from "@/lib/solana";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const wallet = new URL(req.url).searchParams.get("wallet");
  if (!isPubkey(wallet)) return fail("invalid wallet address");
  const nonce = randomUUID().replace(/-/g, "");
  const host = new URL(req.url).host;
  const message = [
    `${host} wants you to sign in to Stock Quant with your Solana account:`,
    wallet,
    "",
    "This signature proves you own this wallet. It does not move funds or cost gas.",
    "",
    `Nonce: ${nonce}`,
    `Issued At: ${new Date().toISOString()}`,
  ].join("\n");
  const sql = db();
  await sql`INSERT INTO auth_nonces (nonce, wallet, message, expires_at) VALUES (${nonce}, ${wallet}, ${message}, now() + interval '10 minutes')`;
  return json({ nonce, message });
}
