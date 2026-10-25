import nacl from "tweetnacl";
import bs58 from "bs58";
import { PublicKey } from "@solana/web3.js";
import { db } from "@/lib/db";
import { fail, issueSession, json } from "@/lib/auth";
import { isPubkey } from "@/lib/solana";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { wallet?: string; nonce?: string; signature?: string };
  if (!isPubkey(body.wallet) || typeof body.nonce !== "string" || typeof body.signature !== "string") return fail("bad request");
  const sql = db();
  const rows = await sql<{ message: string }[]>`
    DELETE FROM auth_nonces WHERE nonce = ${body.nonce} AND wallet = ${body.wallet} AND expires_at > now() RETURNING message`;
  if (!rows.length) return fail("sign-in request expired, try again", 401);
  let ok = false;
  try {
    ok = nacl.sign.detached.verify(new TextEncoder().encode(rows[0].message), bs58.decode(body.signature), new PublicKey(body.wallet).toBytes());
  } catch { ok = false; }
  if (!ok) return fail("signature didn't match this wallet", 401);
  await sql`INSERT INTO users (wallet) VALUES (${body.wallet}) ON CONFLICT DO NOTHING`;
  const res = json({ wallet: body.wallet });
  await issueSession(res, body.wallet);
  return res;
}
