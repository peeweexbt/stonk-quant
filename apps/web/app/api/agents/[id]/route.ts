import { db } from "@/lib/db";
import { fail, json, sessionWallet } from "@/lib/auth";

export const dynamic = "force-dynamic";

function downsample<T>(arr: T[], n: number) {
  if (arr.length <= n) return arr;
  const out: T[] = [];
  for (let i = 0; i < n; i++) out.push(arr[Math.floor((i / (n - 1)) * (arr.length - 1))]);
  return out;
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const id = Number(params.id);
  if (!Number.isInteger(id)) return fail("bad id");
  const sql = db();
  const [agent] = await sql<any[]>`
    SELECT id, owner, name, strat, risk, cadence_mul, uni, color, status, address, deposited_usd, withdrawn_usd, equity_usd, cash_usd,
           sol_balance, holdings, note, trades, volume_usd, error, created_at, last_rebalance_at, sim
    FROM agents WHERE id = ${id}`;
  if (!agent) return fail("agent not found", 404);
  const [events, equity, deposits] = await Promise.all([
    sql`SELECT id, ts, type, text, sig FROM agent_events WHERE agent_id = ${id} ORDER BY ts DESC LIMIT 120`,
    sql<{ ts: string; equity: number }[]>`SELECT ts, equity FROM agent_equity WHERE agent_id = ${id} AND ts > now() - interval '7 days' ORDER BY ts ASC`,
    sql`SELECT sig, usdc, sol, ts FROM deposits WHERE agent_id = ${id} ORDER BY ts DESC LIMIT 20`,
  ]);
  return json({ agent, events, equity: downsample(equity.map((e) => e.equity), 300), deposits }, 200, { "cache-control": "no-store" });
}

/** Owner controls: pause / resume / risk. */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const wallet = await sessionWallet();
  if (!wallet) return fail("sign in first", 401);
  const id = Number(params.id);
  const b = (await req.json().catch(() => ({}))) as { action?: string; risk?: number };
  const sql = db();
  const [agent] = await sql<{ owner: string; status: string }[]>`SELECT owner, status FROM agents WHERE id = ${id}`;
  if (!agent) return fail("agent not found", 404);
  if (agent.owner !== wallet) return fail("that agent isn't yours", 403);

  if (b.risk !== undefined) {
    const risk = Math.round(Number(b.risk));
    if (!(risk >= 1 && risk <= 10)) return fail("risk must be 1 to 10");
    await sql`UPDATE agents SET risk = ${risk}, updated_at = now() WHERE id = ${id}`;
    await sql`INSERT INTO agent_events (agent_id, type, text) VALUES (${id}, 'evt', ${`risk dial set to ${risk}`})`;
  }
  if (b.action === "pause") {
    if (agent.status !== "live") return fail("only a live agent can be paused");
    await sql`UPDATE agents SET status = 'paused', updated_at = now() WHERE id = ${id}`;
    await sql`INSERT INTO agent_events (agent_id, type, text) VALUES (${id}, 'evt', 'paused by owner, positions held')`;
  } else if (b.action === "resume") {
    if (agent.status !== "paused") return fail("only a paused agent can be resumed");
    await sql`UPDATE agents SET status = 'live', note = null, updated_at = now() WHERE id = ${id}`;
    await sql`INSERT INTO agent_events (agent_id, type, text) VALUES (${id}, 'evt', 'resumed by owner')`;
  }
  return json({ ok: true });
}
