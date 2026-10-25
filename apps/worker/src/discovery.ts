import { CURATED_ASSETS, USDC_MINT, type AssetKind } from "@stonkquant/core";
import { sql } from "./db";
import { env } from "./env";
import { getQuote } from "./jupiter";

/**
 * Finds launchpad coins tied to tokenized stocks and keeps the liquid, routable ones in the
 * tradable universe:
 *   pair  – stonk.fun coins launched against xStocks / PreStocks
 *   pump  – pump.fun "custom pairs" coins quoted in xStocks / PreStocks (bonding curve or PumpSwap)
 *   otc   – otcdesks.cash coins whose holder rewards are paid in xStocks / PreStocks
 */

interface Candidate {
  kind: Extract<AssetKind, "pair" | "pump" | "otc">;
  mint: string;
  sym: string;
  name: string;
  quoteMint: string | null;
  quoteSym: string | null;
  logo: string | null;
  pool: string | null;
  mcap: number;
  vol: number;
}

const curated = new Set(CURATED_ASSETS.map((a) => a.mint));
const STOCKS = CURATED_ASSETS.filter((a) => a.kind === "xstock" || a.kind === "prestock");
const stockSym = new Map(STOCKS.map((a) => [a.mint, a.sym]));
const UA = { accept: "application/json", "user-agent": "stonk-quant-worker/0.2" };

const cleanSym = (s: string) => s.replace(/[^\w$-]/g, "").slice(0, 12) || "COIN";
const FLOORS: Record<Candidate["kind"], () => [number, number]> = {
  pair: () => [env.discovery.minMcapUsd, env.discovery.minVol24hUsd],
  pump: () => [env.discovery.pumpMinMcapUsd, env.discovery.pumpMinVol24hUsd],
  otc: () => [env.discovery.otcMinMcapUsd, env.discovery.otcMinVol24hUsd],
};
const passes = (c: Candidate) => { const [m, v] = FLOORS[c.kind](); return c.mcap >= m && c.vol >= v; };

async function getJson<T>(url: string, timeoutMs = 15_000): Promise<T> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: UA, signal: ctl.signal });
    if (!res.ok) throw new Error(`${new URL(url).host} ${res.status}`);
    return (await res.json()) as T;
  } finally { clearTimeout(t); }
}

/* ---------- stonk.fun ---------- */
async function fromStonkfun(): Promise<Candidate[]> {
  type Pool = { pool: string; mint: string; name: string; symbol: string; imageUrl?: string; quoteMint: string; quoteSymbol: string; marketCapUsd?: number; volume24hUsd?: number };
  const out: Candidate[] = [];
  for (const cat of ["xstock", "prestock"]) {
    const data = await getJson<{ pools?: Pool[] }>(`${env.stonkfunBase}/api/v2/platform-pools?sort=marketCap&page=1&pageSize=40&category=${cat}`);
    for (const p of data.pools ?? []) {
      out.push({ kind: "pair", mint: p.mint, sym: cleanSym(p.symbol), name: p.name, quoteMint: p.quoteMint, quoteSym: stockSym.get(p.quoteMint) ?? p.quoteSymbol,
        logo: p.imageUrl ?? null, pool: p.pool, mcap: p.marketCapUsd ?? 0, vol: p.volume24hUsd ?? 0 });
    }
  }
  return out;
}

/* ---------- pump.fun custom pairs (via DexScreener, which indexes pump bonding curves + PumpSwap) ---------- */
async function fromPump(): Promise<Candidate[]> {
  type DsPair = { dexId: string; pairAddress: string; baseToken: { address: string; symbol: string; name: string }; quoteToken: { address: string };
    marketCap?: number; fdv?: number; volume?: { h24?: number }; info?: { imageUrl?: string } };
  const out: Candidate[] = [];
  for (const s of STOCKS) {
    try {
      const pairs = await getJson<DsPair[]>(`https://api.dexscreener.com/token-pairs/v1/solana/${s.mint}`);
      for (const p of Array.isArray(pairs) ? pairs : []) {
        if (p.quoteToken?.address !== s.mint) continue;
        if (p.dexId !== "pumpfun" && p.dexId !== "pumpswap") continue;
        out.push({ kind: "pump", mint: p.baseToken.address, sym: cleanSym(p.baseToken.symbol), name: p.baseToken.name, quoteMint: s.mint, quoteSym: s.sym,
          logo: p.info?.imageUrl ?? null, pool: p.pairAddress, mcap: p.marketCap ?? p.fdv ?? 0, vol: p.volume?.h24 ?? 0 });
      }
    } catch (e) { console.warn("[discovery:pump]", s.sym, (e as Error).message); }
    await new Promise((r) => setTimeout(r, 250)); // stay well under DexScreener's rate limit
  }
  return out;
}

/* ---------- OTC desks (coins paying holder rewards in stocks) ---------- */
async function fromOtc(): Promise<Candidate[]> {
  type Coin = { mint: string; name: string; symbol: string; image?: string; rewardMint?: string; rewardSymbol?: string; rewardBasket?: string[];
    snapshot?: { marketCap?: number; volume24h?: number } };
  const out: Candidate[] = [];
  const seen = new Set<string>();
  for (const sort of ["marketCap", "volume24h"]) {
    const data = await getJson<{ coins?: Coin[] }>(`${env.otcBase}/api/coins?page=0&size=60&sort=${sort}&dir=desc`);
    for (const c of data.coins ?? []) {
      if (seen.has(c.mint)) continue;
      seen.add(c.mint);
      const basket = [...new Set([c.rewardMint, ...(c.rewardBasket ?? [])].filter(Boolean) as string[])];
      const stocksPaid = basket.filter((m) => stockSym.has(m));
      if (!stocksPaid.length) continue; // stock rewards only
      const lead = c.rewardMint && stockSym.has(c.rewardMint) ? c.rewardMint : stocksPaid[0];
      const label = stockSym.get(lead)! + (stocksPaid.length > 1 ? `+${stocksPaid.length - 1}` : "");
      out.push({ kind: "otc", mint: c.mint, sym: cleanSym(c.symbol), name: c.name, quoteMint: lead, quoteSym: label,
        logo: c.image ?? null, pool: null, mcap: c.snapshot?.marketCap ?? 0, vol: c.snapshot?.volume24h ?? 0 });
    }
  }
  return out;
}

/* ---------- routability (can Jupiter actually trade it?) ---------- */
const routeCache = new Map<string, { ok: boolean; at: number }>();
async function routable(mint: string): Promise<boolean> {
  const hit = routeCache.get(mint);
  if (hit && Date.now() - hit.at < 6 * 3600_000) return hit.ok;
  let ok = false;
  try {
    const q = await getQuote(USDC_MINT, mint, 10_000_000n, 500); // $10 test route
    ok = BigInt(q.outAmount) > 0n && Number(q.priceImpactPct) * 100 < 5;
  } catch { ok = false; }
  routeCache.set(mint, { ok, at: Date.now() });
  return ok;
}

async function upsert(c: Candidate) {
  await sql`
    INSERT INTO assets (mint, sym, name, kind, decimals, quote_mint, quote_sym, logo, pool, mcap_usd, vol24h_usd, active)
    VALUES (${c.mint}, ${c.sym}, ${c.name.slice(0, 60)}, ${c.kind}, 6, ${c.quoteMint}, ${c.quoteSym}, ${c.logo}, ${c.pool}, ${c.mcap}, ${c.vol}, true)
    ON CONFLICT (mint) DO UPDATE SET sym = EXCLUDED.sym, name = EXCLUDED.name, kind = EXCLUDED.kind, quote_mint = EXCLUDED.quote_mint, quote_sym = EXCLUDED.quote_sym,
      logo = EXCLUDED.logo, pool = EXCLUDED.pool, mcap_usd = EXCLUDED.mcap_usd, vol24h_usd = EXCLUDED.vol24h_usd, active = true, updated_at = now()`;
}

const SOURCES: { kind: Candidate["kind"]; enabled: () => boolean; max: () => number; fetch: () => Promise<Candidate[]> }[] = [
  { kind: "pair", enabled: () => true, max: () => env.discovery.max, fetch: fromStonkfun },
  { kind: "pump", enabled: () => env.discovery.pump, max: () => env.discovery.maxPump, fetch: fromPump },
  { kind: "otc", enabled: () => env.discovery.otc, max: () => env.discovery.maxOtc, fetch: fromOtc },
];

/** Returns how many coins of each kind are in the universe after this pass. */
export async function discoverPairs(): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  const claimed = new Set<string>(curated);
  for (const src of SOURCES) {
    if (!src.enabled()) { await sql`UPDATE assets SET active = false WHERE kind = ${src.kind} AND active`; counts[src.kind] = 0; continue; }
    let found: Candidate[];
    try { found = await src.fetch(); }
    catch (e) { console.warn(`[discovery:${src.kind}]`, (e as Error).message); continue; } // keep last good set on failure
    // best entry per mint, liquid first
    const best = new Map<string, Candidate>();
    for (const c of found.filter(passes)) {
      if (claimed.has(c.mint)) continue;
      const prev = best.get(c.mint);
      if (!prev || c.mcap > prev.mcap) best.set(c.mint, c);
    }
    const ranked = [...best.values()].sort((a, b) => b.mcap - a.mcap);
    const keep: Candidate[] = [];
    for (const c of ranked) {
      if (keep.length >= src.max()) break;
      if (await routable(c.mint)) keep.push(c);
    }
    for (const c of keep) { await upsert(c); claimed.add(c.mint); }
    const mints = keep.map((c) => c.mint);
    if (mints.length) await sql`UPDATE assets SET active = false, updated_at = now() WHERE kind = ${src.kind} AND active AND NOT (mint = ANY(${mints}))`;
    else await sql`UPDATE assets SET active = false, updated_at = now() WHERE kind = ${src.kind} AND active`;
    counts[src.kind] = keep.length;
  }
  return counts;
}

/** Fallback USD prices straight from stonk.fun for pair coins Jupiter couldn't price. */
export async function stonkfunPrices(pools: { mint: string; pool: string }[]): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  if (!pools.length) return out;
  try {
    const data = await getJson<{ stats?: Record<string, { priceUsd?: number }> }>(`${env.stonkfunBase}/api/pool-stats?pools=${pools.map((p) => p.pool).join(",")}`);
    for (const p of pools) {
      const v = data.stats?.[p.pool]?.priceUsd;
      if (v && v > 0) out[p.mint] = v;
    }
  } catch { /* best effort */ }
  return out;
}
