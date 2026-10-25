# Stonk Quant

Agent launchpad on Solana. Users connect Phantom, spawn an ASCII agent with a strategy and risk dial, fund its own vault with USDC + a little SOL, and the agent trades tokenized stocks (xStocks), pre-IPO tokens (PreStocks), STONK and the liquid launchpad coins tied to them: stonk.fun pairs, pump.fun custom pairs, and OTC desk coins that pay holders in stocks. Owners can pause, change risk, top up, or withdraw everything back to their wallet at any time.

```
apps/web      Next.js 14 site + API (Vercel)       Phantom sign-in, spawn, deposits, desk, live floor
apps/worker   Node worker (Railway)                prices, stonk.fun discovery, Turnkey vaults, Jupiter trades, withdrawals
packages/core shared                               asset list (real mints), strategies, schema, limits
```

## How money moves

1. **Spawn**: the web API inserts an agent row (`provisioning`). The web app never holds keys.
2. **Vault**: the worker creates one Turnkey wallet per agent (`awaiting_deposit`).
3. **Deposit**: the owner signs a Phantom transaction sending USDC + SOL straight to the vault. The API reads it on-chain and records the USDC as the P&L baseline. The worker sees the balance and flips the agent `live`.
4. **Trading**: every minute the worker stores prices (Jupiter Price API, stonk.fun fallback), and each due agent computes target weights → orders → Jupiter quote → swap tx → signed by Turnkey → sent and confirmed. USDC is the hub asset.
5. **Withdraw**: owner clicks Withdraw → worker sells to USDC, creates a one-off Turnkey policy that only allows transfers from *that* wallet to the owner, sends USDC (and anything unsellable), closes token accounts, sweeps SOL. Agent becomes `retired`.

## Key custody (Turnkey)

Two API users in one Turnkey organization:

| User | Root? | Used for |
| --- | --- | --- |
| **Provisioner** | yes (root quorum) | `createWallet`, `createPolicy` |
| **Signer** | **no** | signs every agent transaction, so policies apply |

Policies (root bypasses policies, which is why signing goes through the non-root user):

- **Swap policy** (created once by `npm run setup:turnkey`): signer may sign transactions that only touch Jupiter, ComputeBudget, Token, Token-2022, ATA and System programs, with **zero** direct SOL or SPL transfers.
- **Withdraw policy** (created per withdrawal): `wallet.id == <that agent>` and every transfer goes to the owner's wallet / the owner's token accounts.

⚠️ Test both before opening to anyone. In the Turnkey dashboard, watch the activity log on your first $5 swap and your first withdrawal. If a swap is denied because of a program the parser counts, re-run setup with it: `npm run setup:turnkey -- <programId>`.

## Setup

### 0. Accounts you need
- Turnkey org with the two API users above (Dashboard → Users → add API key)
- Railway project
- Vercel project
- A paid Solana RPC (Helius etc.)
- Optional: Jupiter API key from portal.jup.ag (without it, the free lite API is used)

### 1. Install
```bash
npm install
cp .env.example .env   # fill it in
```

### 2. Railway (worker + Postgres)
1. New project → **Add Postgres**.
2. **New service → GitHub repo** (this repo). `railway.json` sets the build and start commands.
3. Variables: everything under "shared" and "worker only" in `.env.example`. Set `DATABASE_URL` to `${{Postgres.DATABASE_URL}}`.
4. Deploy. The worker creates the schema on boot and logs `[tick] … priced N assets` every minute.
5. Once, from your machine with the same env: `npm run setup:turnkey` to create the swap policy.

Keep the worker at **one replica**. Two workers would double-trade.

### 3. Vercel (web)
1. Import the repo, set **Root Directory = `apps/web`** (keep "include files outside root" on).
2. Variables: "shared" + "web only". Use Railway Postgres' **public** URL for `DATABASE_URL`.
3. Deploy. Add your domain.

### 4. Launch checklist
- [ ] Spawn an agent with your own wallet, deposit $25 + 0.03 SOL, watch it go live.
- [ ] Wait for a rebalance (INDEX rebalances right away once prices have 30+ min of history). Check the tx on Solscan.
- [ ] Withdraw and confirm USDC + SOL land back in your wallet.
- [ ] Keep `MAX_DEPOSIT_USD` low for the beta.
- [ ] Kill switches: `TRADING_ENABLED=false` stops new swaps, `WITHDRAWALS_ENABLED=false` holds withdrawals (restart worker after changing).

## Strategies (packages/core/src/strategies.ts)

| Strategy | Universe | Rule | Rebalance |
| --- | --- | --- | --- |
| Momentum Monk | all | top 3 positive 60-min trends, weighted by return | 15 min |
| Reversion Goblin | stocks, STONK | buys assets >0.6σ below their 2h mean | 20 min |
| Index Hugger | xStocks | fixed SPY/QQQ-heavy basket | 4 h |
| Pre-IPO Prophet | PreStocks + their pairs | tilts toward 4h strength | 1 h |
| Pair Sniper | stonk.fun pairs | 15-min breakouts, +18% TP / −9% SL | 5 min |
| Flywheel Farmer | STONK + pairs | 50% STONK, rest in top 4h pairs | 2 h |

Risk dial sets total exposure (37%–100%); per-position caps: xStock 50%, PreStock/STONK 40%, pair coin 20%. Fast/Patient multiplies the cadence.

## Things to know

- **Regulation**: xStocks and PreStocks aren't offered to US persons and several other regions. The geofence (`BLOCKED_COUNTRIES`, Vercel IP country) blocks spawning and deposits, but IP checks are easy to bypass. Running automated trading of tokenized securities with other people's funds may need licenses where you operate. Get legal advice before a public launch.
- **Launchpad discovery** (every 15 min): stonk.fun via its site API (`/api/v2/platform-pools`), pump.fun custom pairs via DexScreener (`/token-pairs/v1/solana/<stock mint>`, dexId `pumpfun`/`pumpswap`), OTC desk coins via `otcdesks.cash/api/coins` (only those whose reward basket includes xStocks/PreStocks). Every candidate must pass the mcap/volume floor and a $10 Jupiter test route before agents can trade it. None of these APIs are documented, so they can change; the curated stocks keep working without them.
- **xStocks are Token-2022** (8 decimals). Balances use the RPC's UI amounts, which include any scaled-UI multiplier.
- **Deposits sent outside the app** still work: after a minute the vault balance becomes the P&L baseline.
- **Priority fees** are capped by `JUPITER_MAX_PRIORITY_LAMPORTS`. Each agent needs SOL; at <0.006 SOL it pauses itself.
