import { CURATED_ASSETS } from "@stonkquant/core";
import { sql } from "./db";
import { env } from "./env";

interface Pool {
  pool: string;
  mint: string;
  name: string;
  symbol: string;
  imageUrl?: string;
  quoteMint: string;
  quoteSymbol: string;
  marketCapUsd?: number;
  volume24hUsd?: number;
}

const curated = new Set(CURATED_ASSETS.map((a) => a.mint));

async function fetchCategory(category: string): Promise<Pool[]> {
  const url = `${env.stonkfunBase}/api/v2/platform-pools?sort=marketCap&page=1&pageSize=40&category=${category}`;
  const res = await fetch(url, { headers: { accept: "application/json", "user-agent": "stonk-quant-worker/0.1" } });
  if (!res.ok) throw new Error(`stonk.fun ${category} ${res.status}`);
  const data = (await res.json()) as { pools?: Pool[] };
  return data.pools ?? [];
}

/**
 * Finds stonk.fun coins launched against tokenized stocks / pre-IPO tokens and keeps the
 * liquid ones in the tradable universe as "pair" assets.
 */
export async function discoverPairs() {
  const pools: Pool[] = [];
  for (const cat of ["xstock", "prestock"]) {
    try { pools.push(...(await fetchCategory(cat))); } catch (e) { console.warn("[discovery]", (e as Error).message); }
  }
  if (!pools.length) return 0;
  const keep = pools
    .filter((p) => !curated.has(p.mint))
    .filter((p) => (p.marketCapUsd ?? 0) >= env.discovery.minMcapUsd && (p.volume24hUsd ?? 0) >= env.discovery.minVol24hUsd)
    .sort((a, b) => (b.marketCapUsd ?? 0) - (a.marketCapUsd ?? 0))
    .slice(0, env.discovery.max);
  const quoteSym = new Map(CURATED_ASSETS.map((a) => [a.mint, a.sym]));
  for (const p of keep) {
    const sym = p.symbol.replace(/[^\w$-]/g, "").slice(0, 12) || "PAIR";
    await sql`
      INSERT INTO assets (mint, sym, name, kind, decimals, quote_mint, quote_sym, logo, pool, mcap_usd, vol24h_usd, active)
      VALUES (${p.mint}, ${sym}, ${p.name.slice(0, 60)}, 'pair', 6, ${p.quoteMint}, ${quoteSym.get(p.quoteMint) ?? p.quoteSymbol}, ${p.imageUrl ?? null}, ${p.pool}, ${p.marketCapUsd ?? null}, ${p.volume24hUsd ?? null}, true)
      ON CONFLICT (mint) DO UPDATE SET sym = EXCLUDED.sym, name = EXCLUDED.name, quote_mint = EXCLUDED.quote_mint, quote_sym = EXCLUDED.quote_sym,
        logo = EXCLUDED.logo, pool = EXCLUDED.pool, mcap_usd = EXCLUDED.mcap_usd, vol24h_usd = EXCLUDED.vol24h_usd, active = true, updated_at = now()`;
  }
  const mints = keep.map((p) => p.mint);
  if (mints.length) await sql`UPDATE assets SET active = false, updated_at = now() WHERE kind = 'pair' AND active AND NOT (mint = ANY(${mints}))`;
  else await sql`UPDATE assets SET active = false, updated_at = now() WHERE kind = 'pair' AND active`;
  return keep.length;
}

/** Fallback USD prices straight from stonk.fun for pair coins Jupiter couldn't price. */
export async function stonkfunPrices(pools: { mint: string; pool: string }[]): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  if (!pools.length) return out;
  try {
    const res = await fetch(`${env.stonkfunBase}/api/pool-stats?pools=${pools.map((p) => p.pool).join(",")}`, { headers: { accept: "application/json" } });
    if (!res.ok) return out;
    const data = (await res.json()) as { stats?: Record<string, { priceUsd?: number }> };
    for (const p of pools) {
      const v = data.stats?.[p.pool]?.priceUsd;
      if (v && v > 0) out[p.mint] = v;
    }
  } catch { /* best effort */ }
  return out;
}
