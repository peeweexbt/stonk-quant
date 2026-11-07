import { randomBytes } from "crypto";
import { db } from "@/lib/db";
import { fail, json, sessionWallet } from "@/lib/auth";

export const dynamic = "force-dynamic";

const bot = () => process.env.TELEGRAM_BOT_USERNAME?.replace(/^@/, "") || null;

/** Is Telegram set up, and is this wallet linked? */
export async function GET() {
  const wallet = await sessionWallet();
  if (!bot()) return json({ enabled: false }, 200, { "cache-control": "no-store" });
  if (!wallet) return json({ enabled: true, linked: false, bot: bot() }, 200, { "cache-control": "no-store" });
  const [u] = await db()<{ linked: boolean }[]>`SELECT telegram_chat_id IS NOT NULL AS linked FROM users WHERE wallet = ${wallet}`;
  return json({ enabled: true, linked: !!u?.linked, bot: bot() }, 200, { "cache-control": "no-store" });
}

/** Issue a one-time link code (15 min) and return the t.me deep link. */
export async function POST() {
  const wallet = await sessionWallet();
  if (!wallet) return fail("sign in first", 401);
  if (!bot()) return fail("Telegram alerts aren't set up yet", 503);
  const code = randomBytes(12).toString("base64url");
  await db()`INSERT INTO users (wallet, tg_code, tg_code_expires) VALUES (${wallet}, ${code}, now() + interval '15 minutes')
             ON CONFLICT (wallet) DO UPDATE SET tg_code = EXCLUDED.tg_code, tg_code_expires = EXCLUDED.tg_code_expires`;
  return json({ url: `https://t.me/${bot()}?start=${code}` }, 200, { "cache-control": "no-store" });
}

/** Turn alerts off for this wallet. */
export async function DELETE() {
  const wallet = await sessionWallet();
  if (!wallet) return fail("sign in first", 401);
  await db()`UPDATE users SET telegram_chat_id = null WHERE wallet = ${wallet}`;
  return json({ ok: true }, 200, { "cache-control": "no-store" });
}
