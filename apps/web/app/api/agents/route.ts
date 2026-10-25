import { ALL_KINDS, LIMITS, STRATS, type StratKey } from "@stonkquant/core";
import { db } from "@/lib/db";
import { fail, json, sessionWallet } from "@/lib/auth";
import { restrictedCountry, RESTRICTED_MSG } from "@/lib/geo";

export const dynamic = "force-dynamic";

const KINDS: string[] = ALL_KINDS;

export async function POST(req: Request) {
  if (restrictedCountry(req)) return fail(RESTRICTED_MSG, 451);
  const wallet = await sessionWallet();
  if (!wallet) return fail("sign in with your wallet first", 401);
  const b = (await req.json().catch(() => ({}))) as {
    name?: string; strat?: string; risk?: number; uni?: string[]; cadenceMul?: number; acceptTerms?: boolean;
  };
  const name = String(b.name ?? "").toUpperCase().replace(/[^A-Z0-9\- ]/g, "").trim().slice(0, 14);
  if (!name) return fail("give the agent a handle (letters, numbers, dashes)");
  if (!b.strat || !(b.strat in STRATS)) return fail("pick a strategy");
  const risk = Math.round(Number(b.risk));
  if (!(risk >= 1 && risk <= 10)) return fail("risk must be 1 to 10");
  const uni = Array.isArray(b.uni) ? [...new Set(b.uni.filter((k) => KINDS.includes(k)))] : [];
  if (!uni.length) return fail("allow at least one asset type");
  const cad = [0.5, 1, 2.5].includes(Number(b.cadenceMul)) ? Number(b.cadenceMul) : 1;
  if (!b.acceptTerms) return fail("please accept the risk disclosure");

  const sql = db();
  const [{ n }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM agents WHERE owner = ${wallet} AND status <> 'retired'`;
  if (n >= LIMITS.maxAgentsPerWallet) return fail(`you can run up to ${LIMITS.maxAgentsPerWallet} agents at once. Retire one first.`);
  const taken = await sql`SELECT 1 FROM agents WHERE upper(name) = ${name} AND status <> 'retired' LIMIT 1`;
  if (taken.length) return fail(`${name} is already on the floor. Pick another handle.`);

  await sql`INSERT INTO users (wallet, accepted_terms_at) VALUES (${wallet}, now())
            ON CONFLICT (wallet) DO UPDATE SET accepted_terms_at = coalesce(users.accepted_terms_at, now())`;
  const [row] = await sql<{ id: number }[]>`
    INSERT INTO agents (owner, name, strat, risk, cadence_mul, uni, color, status)
    VALUES (${wallet}, ${name}, ${b.strat as StratKey}, ${risk}, ${cad}, ${uni}, ${Math.floor(Math.random() * 6)}, 'provisioning')
    RETURNING id`;
  await sql`INSERT INTO agent_events (agent_id, type, text) VALUES (${row.id}, 'boot', ${`spawned as ${STRATS[b.strat as StratKey].label}, risk ${risk}`})`;
  return json({ id: row.id });
}
