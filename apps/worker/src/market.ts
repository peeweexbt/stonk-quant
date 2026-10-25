import type { AssetKind, MarketAsset } from "@stonkquant/core";
import { sql } from "./db";
import { getPrices } from "./jupiter";
import { stonkfunPrices } from "./discovery";

export interface AssetRow {
  mint: string;
  sym: string;
  name: string;
  kind: AssetKind;
  decimals: number;
  quote_mint: string | null;
  quote_sym: string | null;
  pool: string | null;
  active: boolean;
}

const HISTORY = 480; // minutes kept in memory (8h) for strategies

class Market {
  assets = new Map<string, AssetRow>();
  hist = new Map<string, number[]>();

  async loadAssets() {
    const rows = await sql<AssetRow[]>`SELECT mint, sym, name, kind, decimals, quote_mint, quote_sym, pool, active FROM assets`;
    this.assets = new Map(rows.map((r) => [r.mint, r]));
  }

  async loadHistory() {
    const rows = await sql<{ mint: string; price: number }[]>`
      SELECT mint, price FROM price_ticks WHERE ts > now() - make_interval(mins => ${HISTORY}) ORDER BY ts ASC`;
    this.hist.clear();
    for (const r of rows) {
      const h = this.hist.get(r.mint) ?? [];
      h.push(r.price);
      this.hist.set(r.mint, h);
    }
  }

  price(mint: string): number | undefined {
    const h = this.hist.get(mint);
    return h && h.length ? h[h.length - 1] : undefined;
  }

  /** Fetch prices for every active asset plus anything agents hold, store one tick per minute. */
  async tick(extraMints: string[]) {
    const mints = new Set<string>([...[...this.assets.values()].filter((a) => a.active).map((a) => a.mint), ...extraMints.filter((m) => this.assets.has(m))]);
    const list = [...mints];
    const prices = await getPrices(list);
    const missing = list.filter((m) => !prices[m]).map((m) => this.assets.get(m)).filter((a): a is AssetRow => !!a && !!a.pool && a.kind === "pair");
    Object.assign(prices, await stonkfunPrices(missing.map((a) => ({ mint: a.mint, pool: a.pool! }))));
    const ts = new Date(Math.floor(Date.now() / 60000) * 60000);
    const rows: { mint: string; ts: Date; price: number }[] = [];
    for (const m of list) {
      let p = prices[m];
      if (!p) p = this.price(m) ?? 0; // carry forward so minute series stay aligned
      if (!p) continue;
      const h = this.hist.get(m) ?? [];
      h.push(p);
      if (h.length > HISTORY) h.splice(0, h.length - HISTORY);
      this.hist.set(m, h);
      rows.push({ mint: m, ts, price: p });
    }
    if (rows.length) await sql`INSERT INTO price_ticks ${sql(rows, "mint", "ts", "price")} ON CONFLICT (mint, ts) DO UPDATE SET price = EXCLUDED.price`;
    return Object.keys(prices).length;
  }

  view(): MarketAsset[] {
    const out: MarketAsset[] = [];
    for (const a of this.assets.values()) {
      if (!a.active) continue;
      const h = this.hist.get(a.mint);
      if (!h || !h.length) continue;
      out.push({ mint: a.mint, sym: a.sym, kind: a.kind, quoteMint: a.quote_mint, h });
    }
    return out;
  }
}

export const market = new Market();
