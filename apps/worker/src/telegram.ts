// Telegram alerts: owners link their wallet to a chat via /start <code> (code issued by the website),
// then get a message for their agents' trades, risk exits, deposits, withdrawals, errors and learning updates.
import type { EventType } from "./db";
import { sql } from "./db";
import { env } from "./env";

const enabled = () => !!env.telegram.token;
const api = (method: string) => `https://api.telegram.org/bot${env.telegram.token}/${method}`;

async function call<T>(method: string, body: Record<string, unknown>): Promise<T | null> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 15_000);
  try {
    const res = await fetch(api(method), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: ctl.signal });
    const j = (await res.json()) as { ok: boolean; result?: T; description?: string };
    if (!j.ok) { console.warn(`[telegram] ${method}: ${j.description}`); return null; }
    return j.result ?? null;
  } catch (e) { console.warn(`[telegram] ${method}:`, (e as Error).message); return null; }
  finally { clearTimeout(t); }
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
export const tgSend = (chatId: number | string, html: string) =>
  call("sendMessage", { chat_id: chatId, text: html, parse_mode: "HTML", disable_web_page_preview: true });

/* ---------------- alerts ---------------- */

const ICON: Partial<Record<EventType, string>> = { buy: "🟢", sell: "🔴", err: "⚠️", evt: "🔷", learn: "🧠" };
const recentErr = new Map<string, number>();
const ownerCache = new Map<number, { at: number; chat: string | null; name: string; sim: boolean }>();

async function ownerChat(agentId: number) {
  const hit = ownerCache.get(agentId);
  if (hit && Date.now() - hit.at < 60_000) return hit;
  const [r] = await sql<{ name: string; sim: boolean; chat: string | null }[]>`
    SELECT a.name, a.sim, u.telegram_chat_id::text AS chat FROM agents a JOIN users u ON u.wallet = a.owner WHERE a.id = ${agentId}`;
  const v = { at: Date.now(), chat: r?.chat ?? null, name: r?.name ?? `#${agentId}`, sim: !!r?.sim };
  ownerCache.set(agentId, v);
  return v;
}

/** Event hook: forwards notable events for real agents to their owner's Telegram chat. */
export async function notifyOwner(agentId: number, type: EventType, text: string, sig?: string | null) {
  if (!enabled() || !ICON[type]) return;
  const o = await ownerChat(agentId);
  if (!o.chat || o.sim) return;
  if (type === "err") {
    // the same error repeating every minute shouldn't spam the owner
    const key = `${agentId}:${text.slice(0, 60)}`;
    const last = recentErr.get(key) ?? 0;
    if (Date.now() - last < 30 * 60_000) return;
    recentErr.set(key, Date.now());
  }
  const link = `${env.siteUrl}/app#agent-${agentId}`;
  const tx = sig ? ` · <a href="https://solscan.io/tx/${sig}">tx</a>` : "";
  await tgSend(o.chat, `${ICON[type]} <b>${esc(o.name)}</b>\n${esc(text)}${tx}\n<a href="${link}">open desk</a>`);
}

/* ---------------- bot commands (long-poll) ---------------- */

interface Update { update_id: number; message?: { chat: { id: number }; text?: string } }
let offset = 0;
let polling = false;

async function agentsFor(chatId: number) {
  return sql<{ id: number; name: string; status: string; equity_usd: number; deposited_usd: number; withdrawn_usd: number }[]>`
    SELECT a.id, a.name, a.status, a.equity_usd, a.deposited_usd, a.withdrawn_usd FROM agents a JOIN users u ON u.wallet = a.owner
    WHERE u.telegram_chat_id = ${chatId} AND a.status <> 'retired' AND NOT a.sim ORDER BY a.id`;
}

async function statusText(chatId: number) {
  const rows = await agentsFor(chatId);
  if (!rows.length) return "No agents yet. Spawn one at " + env.siteUrl + "/app";
  return rows.map((a) => {
    const base = a.deposited_usd - a.withdrawn_usd;
    const pnl = base > 0 ? a.equity_usd / base - 1 : 0;
    return `<b>${esc(a.name)}</b> · ${a.status} · $${a.equity_usd.toFixed(2)} (${pnl >= 0 ? "+" : ""}${(pnl * 100).toFixed(2)}%)`;
  }).join("\n");
}

async function handle(u: Update) {
  const chat = u.message?.chat.id;
  const text = (u.message?.text ?? "").trim();
  if (!chat || !text) return;
  const [cmd, arg] = text.split(/\s+/, 2);
  if (cmd === "/start" && arg) {
    const [user] = await sql<{ wallet: string }[]>`
      UPDATE users SET telegram_chat_id = ${chat}, tg_code = null, tg_code_expires = null
      WHERE tg_code = ${arg} AND tg_code_expires > now() RETURNING wallet`;
    if (!user) { await tgSend(chat, "That link expired. Click <b>Telegram alerts</b> on the site again to get a fresh one."); return; }
    ownerCache.clear();
    await tgSend(chat, `✅ Connected to wallet <code>${user.wallet.slice(0, 4)}…${user.wallet.slice(-4)}</code>.\nYou'll get alerts for your agents' trades, stops, deposits, withdrawals and errors.\n\n${await statusText(chat)}\n\n/status · your agents\n/stop · turn alerts off`);
  } else if (cmd === "/status") {
    await tgSend(chat, await statusText(chat));
  } else if (cmd === "/stop") {
    await sql`UPDATE users SET telegram_chat_id = null WHERE telegram_chat_id = ${chat}`;
    ownerCache.clear();
    await tgSend(chat, "🔕 Alerts off. Reconnect any time from the site.");
  } else {
    await tgSend(chat, `Stock Quant alerts.\nConnect from ${env.siteUrl}/app (sign in → <b>Telegram alerts</b>).\n\n/status · your agents\n/stop · turn alerts off`);
  }
}

export async function pollTelegram() {
  if (!enabled() || polling) return;
  polling = true;
  try {
    const updates = await call<Update[]>("getUpdates", { offset, timeout: 0, allowed_updates: ["message"] });
    for (const u of updates ?? []) {
      offset = u.update_id + 1;
      await handle(u).catch((e) => console.warn("[telegram] handle:", (e as Error).message));
    }
  } finally { polling = false; }
}
