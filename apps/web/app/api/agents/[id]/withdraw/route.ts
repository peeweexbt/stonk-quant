import { db } from "@/lib/db";
import { fail, json, sessionWallet } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** Owner asks the agent to sell to USDC and send everything back. The worker does the work. */
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const wallet = await sessionWallet();
  if (!wallet) return fail("sign in first", 401);
  const id = Number(params.id);
  const sql = db();
  const [agent] = await sql<{ owner: string; status: string; address: string | null }[]>`SELECT owner, status, address FROM agents WHERE id = ${id}`;
  if (!agent) return fail("agent not found", 404);
  if (agent.owner !== wallet) return fail("that agent isn't yours", 403);
  if (agent.status === "provisioning" || !agent.address) {
    await sql`UPDATE agents SET status = 'retired', updated_at = now() WHERE id = ${id}`;
    return json({ ok: true, status: "retired" });
  }
  if (!["live", "paused", "awaiting_deposit"].includes(agent.status)) return fail(`can't withdraw while the agent is ${agent.status}`);
  await sql`UPDATE agents SET status = 'withdrawing', updated_at = now() WHERE id = ${id}`;
  await sql`INSERT INTO agent_events (agent_id, type, text) VALUES (${id}, 'evt', 'owner requested withdrawal')`;
  return json({ ok: true, status: "withdrawing" });
}
