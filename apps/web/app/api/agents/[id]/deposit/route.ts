import { LIMITS } from "@stonkquant/core";
import { db } from "@/lib/db";
import { fail, json, sessionWallet } from "@/lib/auth";
import { restrictedCountry, RESTRICTED_MSG } from "@/lib/geo";
import { readDeposit } from "@/lib/solana";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** Called after Phantom sends the deposit; verifies it on-chain and credits the agent's baseline. */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  if (restrictedCountry(req)) return fail(RESTRICTED_MSG, 451);
  const wallet = await sessionWallet();
  if (!wallet) return fail("sign in first", 401);
  const id = Number(params.id);
  const { signature } = (await req.json().catch(() => ({}))) as { signature?: string };
  if (typeof signature !== "string" || signature.length < 60) return fail("missing transaction signature");

  const sql = db();
  const [agent] = await sql<{ owner: string; address: string | null; status: string; deposited_usd: number; sim: boolean }[]>`
    SELECT owner, address, status, deposited_usd, sim FROM agents WHERE id = ${id}`;
  if (!agent) return fail("agent not found", 404);
  if (agent.sim) return fail("simulated agents can't take deposits", 400);
  if (agent.owner !== wallet) return fail("that agent isn't yours", 403);
  if (!agent.address) return fail("vault isn't ready yet");
  if (["withdrawing", "retired"].includes(agent.status)) return fail("this agent is retiring and can't take deposits");

  const seen = await sql`SELECT 1 FROM deposits WHERE sig = ${signature}`;
  if (seen.length) return json({ ok: true, duplicate: true });

  let d: { usdc: number; sol: number };
  try { d = await readDeposit(signature, agent.address, wallet); }
  catch (e) { return fail((e as Error).message, 409); }

  await sql`INSERT INTO deposits (sig, agent_id, wallet, usdc, sol) VALUES (${signature}, ${id}, ${wallet}, ${d.usdc}, ${d.sol}) ON CONFLICT DO NOTHING`;
  if (d.usdc > 0) {
    await sql`UPDATE agents SET deposited_usd = deposited_usd + ${d.usdc}, updated_at = now() WHERE id = ${id}`;
  }
  const parts = [d.usdc > 0 ? `$${d.usdc.toFixed(2)} USDC` : "", d.sol > 0 ? `${d.sol.toFixed(3)} SOL` : ""].filter(Boolean).join(" + ");
  await sql`INSERT INTO agent_events (agent_id, type, text, sig) VALUES (${id}, 'evt', ${`deposit received: ${parts || "nothing"}`}, ${signature})`;
  const over = agent.deposited_usd + d.usdc > LIMITS.maxDepositUsd;
  return json({ ok: true, ...d, overCap: over });
}
