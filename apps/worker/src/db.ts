import postgres from "postgres";
import { env } from "./env";

export const sql = postgres(env.databaseUrl, {
  max: 5,
  idle_timeout: 30,
  connect_timeout: 10,
  // works with pooled URLs (Neon/pgbouncer) as well as direct ones
  prepare: false,
  // Railway's public Postgres URL needs TLS; internal URLs don't.
  ssl: env.databaseUrl.includes("railway.internal") || env.databaseUrl.includes("localhost") ? false : "require",
});

export type EventType = "buy" | "sell" | "think" | "evt" | "err" | "boot" | "learn";

type EventHook = (agentId: number, type: EventType, text: string, sig?: string | null) => Promise<void>;
let eventHook: EventHook | null = null;
/** Called after every logged event (used for Telegram alerts). Never blocks or throws into the caller. */
export function setEventHook(h: EventHook) { eventHook = h; }

export async function logEvent(agentId: number, type: EventType, text: string, sig?: string | null) {
  await sql`INSERT INTO agent_events (agent_id, type, text, sig) VALUES (${agentId}, ${type}, ${text.slice(0, 400)}, ${sig ?? null})`;
  if (eventHook) eventHook(agentId, type, text, sig).catch(() => {});
}
