import { sql, logEvent } from "./db";
import { env } from "./env";
import { migrate } from "./migrate";
import { market } from "./market";
import { discoverPairs } from "./discovery";
import { checkFunding, loadAgents, provision, refreshOnly, runLive, withdraw, type AgentRow } from "./agents";

const busy = new Set<number>();
// Exponential backoff per agent after an error, so a stuck agent doesn't spam retries.
const backoff = new Map<number, { n: number; until: number }>();
let minuteRunning = false;
let fastRunning = false;

async function guarded(ag: AgentRow, fn: () => Promise<void>, label: string) {
  if (busy.has(ag.id)) return;
  const b = backoff.get(ag.id);
  if (b && Date.now() < b.until) return;
  busy.add(ag.id);
  try { await fn(); backoff.delete(ag.id); }
  catch (e) {
    const n = (b?.n ?? 0) + 1;
    backoff.set(ag.id, { n, until: Date.now() + Math.min(15 * 60_000, 30_000 * 2 ** (n - 1)) });
    const msg = (e as Error).message ?? String(e);
    console.error(`[${label}] agent ${ag.id}:`, msg);
    await logEvent(ag.id, "err", `${label} error: ${msg}`).catch(() => {});
    if (label === "provision") await sql`UPDATE agents SET error = ${msg}, updated_at = now() WHERE id = ${ag.id}`.catch(() => {});
  } finally { busy.delete(ag.id); }
}

/** Every minute: prices, then each live/paused agent. */
async function minuteLoop() {
  if (minuteRunning) return;
  minuteRunning = true;
  const minute = Math.floor(Date.now() / 60000);
  try {
    const agents = await loadAgents(["live", "paused"]);
    const held = agents.flatMap((a) => Object.keys(a.holdings ?? {}));
    const n = await market.tick(held);
    console.log(`[tick] ${new Date().toISOString()} priced ${n} assets, ${agents.length} agents`);
    for (const ag of agents) {
      if (ag.status === "live") await guarded(ag, () => runLive(ag, minute), "trade");
      else await guarded(ag, () => refreshOnly(ag, minute), "refresh");
    }
    if (minute % 60 === 0) {
      await sql`DELETE FROM price_ticks WHERE ts < now() - interval '7 days'`;
      await sql`DELETE FROM agent_equity WHERE ts < now() - interval '30 days'`;
      await sql`DELETE FROM auth_nonces WHERE expires_at < now()`;
    }
  } catch (e) {
    console.error("[tick]", e);
  } finally { minuteRunning = false; }
}

/** Every 10s: things a user is waiting on (new vaults, deposits, withdrawals). */
async function fastLoop() {
  if (fastRunning) return;
  fastRunning = true;
  try {
    const agents = await loadAgents(["provisioning", "awaiting_deposit", "withdrawing"]);
    for (const ag of agents) {
      if (ag.status === "provisioning") await guarded(ag, () => provision(ag), "provision");
      else if (ag.status === "awaiting_deposit" && ag.address) await guarded(ag, () => checkFunding(ag), "funding");
      else if (ag.status === "withdrawing" && ag.address) await guarded(ag, () => withdraw(ag), "withdraw");
    }
  } catch (e) {
    console.error("[fast]", e);
  } finally { fastRunning = false; }
}

let discoveryRunning = false;
async function discoveryLoop() {
  if (discoveryRunning) return; // a slow pass shouldn't stack up behind the next one
  discoveryRunning = true;
  try {
    const n = await discoverPairs();
    await market.loadAssets();
    console.log(`[discovery] stonk.fun ${n.pair ?? "-"} · pump.fun ${n.pump ?? "-"} · OTC ${n.otc ?? "-"} coins in universe`);
  } catch (e) { console.error("[discovery]", e); }
  finally { discoveryRunning = false; }
}

async function main() {
  console.log(`stock-quant worker starting. trading=${env.tradingEnabled} withdrawals=${env.withdrawalsEnabled} jupiter=${env.jupiter.baseUrl}`);
  await migrate();
  await market.loadAssets();
  await market.loadHistory();
  await discoveryLoop();
  await minuteLoop();
  // align the minute loop to the top of each minute
  setTimeout(() => { minuteLoop(); setInterval(minuteLoop, 60_000); }, 60_000 - (Date.now() % 60_000) + 2_000);
  setInterval(fastLoop, 10_000);
  setInterval(discoveryLoop, Math.max(30, env.discovery.intervalSec) * 1000);
  fastLoop();
}

process.on("SIGTERM", async () => { console.log("shutting down"); await sql.end({ timeout: 5 }); process.exit(0); });
main().catch((e) => { console.error(e); process.exit(1); });
