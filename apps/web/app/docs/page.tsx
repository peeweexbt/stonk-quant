import type { Metadata } from "next";
import { KIND_LABEL, LIMITS, MIN_HOLD_MIN, POSITION_CAP, RISK_RULES, STRATS, STRAT_KEYS, exposure, type AssetKind } from "@stonkquant/core";
import { spriteText } from "@/components/sprite-text";

export const metadata: Metadata = {
  title: "Docs · Stock Quant",
  description: "How Stock Quant agents work: vaults, strategies, the tradable universe, fees, limits and withdrawals.",
};

const TOC: [string, string][] = [
  ["overview", "What it is"],
  ["start", "Getting started"],
  ["vaults", "Agent vaults & custody"],
  ["strategies", "Strategies"],
  ["risk", "Risk dial & rebalancing"],
  ["universe", "What agents can trade"],
  ["fees", "Fees & limits"],
  ["withdraw", "Withdrawing"],
  ["faq", "FAQ"],
  ["risks", "Risks & regions"],
];

const KIND_DESC: Record<AssetKind, string> = {
  xstock: "Tokenized US stocks and ETFs issued by Backed (SPYx, QQQx, NVDAx, TSLAx…). Token-2022 tokens that track the underlying share price.",
  prestock: "Pre-IPO exposure tokens (OPENAI, ANTHROPIC, ANDURIL, POLYMARKET, KALSHI, NEURALINK). Thin, volatile, priced by their own markets.",
  pair: "Coins launched on stonk.fun with an xStock or PreStock as their quote asset, so their price moves with both the coin and the stock.",
  pump: "pump.fun custom-pair coins quoted in an xStock or PreStock, on the bonding curve or graduated to PumpSwap. Usually much smaller.",
  otc: "Coins launched through otcdesks.cash that pay their holders rewards in xStocks or PreStocks. Only coins with a stock in their reward basket are included.",
  stonk: "STONK, the stonk.fun platform token. Part of stonk.fun's fee buyback-and-burn.",
};

export default function Docs() {
  return (
    <div className="app docs">
      <header className="topbar">
        <a href="/" className="brand" style={{ textDecoration: "none" }}>STOCK<span>_QUANT</span></a>
        <nav className="nav" aria-label="Sections"><a href="/">Home</a><a href="/app">App</a><a href="/app#spawn">Spawn</a><a href="/docs" aria-current="page">Docs</a></nav>
        <div className="spacer" />
        <a className="btn ghost" href="/app#spawn" style={{ textDecoration: "none" }}>Spawn an agent</a>
      </header>

      <div className="docs-layout">
        <aside className="docs-toc" aria-label="On this page">
          <p className="sub-title">Docs</p>
          {TOC.map(([id, label]) => <a key={id} href={`#${id}`}>{label}</a>)}
        </aside>

        <main className="docs-body">
          <section id="overview">
            <h1>How Stock Quant works</h1>
            <p className="lede">Stock Quant is a launchpad for trading agents. You spawn an agent, give it a strategy and a risk level, and fund its own Solana vault with USDC. The agent then trades tokenized stocks and the launchpad coins tied to them on your behalf, around the clock. You can pause it, change its risk, top it up or withdraw everything back to your wallet at any time.</p>
            <div className="docs-flow">
              {["Connect Phantom", "Spawn an agent", "Fund its vault", "It trades", "Withdraw anytime"].map((s, i) => (
                <div key={s} className="docs-step"><span className="num">{String(i + 1).padStart(2, "0")}</span>{s}</div>
              ))}
            </div>
          </section>

          <section id="start">
            <h2>Getting started</h2>
            <ol>
              <li><b>Connect Phantom.</b> Click <em>Connect Phantom</em> and sign the sign-in message. Signing proves you own the wallet; it doesn't move funds or cost gas.</li>
              <li><b>Spawn an agent.</b> Pick a handle, a strategy, which asset types it may trade, a risk level and how often it rebalances, then accept the risk disclosure.</li>
              <li><b>Fund the vault.</b> Within a few seconds the agent's desk shows its own vault address. Deposit USDC plus about {LIMITS.gasSol} SOL for network fees, straight from Phantom. Minimum first deposit is ${LIMITS.minDepositUsd}; during the beta each agent takes up to ${LIMITS.maxDepositUsd}.</li>
              <li><b>Watch it work.</b> The agent goes live about a minute after the deposit lands. Its desk shows holdings, P&amp;L, an equity chart and a log of every decision and trade with Solscan links.</li>
            </ol>
            <p className="note-sm">You can run up to {LIMITS.maxAgentsPerWallet} agents per wallet at once.</p>
          </section>

          <section id="vaults">
            <h2>Agent vaults &amp; custody</h2>
            <p>Every agent has its own Solana wallet. Funds never sit in a shared pool, and every vault is public on-chain, so anyone can check its balances and trades.</p>
            <ul>
              <li><b>Keys are held by Turnkey</b>, a secure key-management service. The Stock Quant website never sees or stores a private key.</li>
              <li><b>Signing is locked down by policy.</b> The trading key may only sign Jupiter swap transactions, with no direct SOL or token transfers. An agent can swap, but it can't send funds anywhere.</li>
              <li><b>Withdrawals only go to you.</b> When you withdraw, a one-off policy is created that lets that single vault send funds only to the wallet that owns it.</li>
              <li><b>USDC is home base.</b> Agents hold USDC between positions and every trade routes USDC ⇄ asset through Jupiter.</li>
            </ul>
          </section>

          <section id="strategies">
            <h2>Strategies</h2>
            <p>Each strategy is a simple, transparent rule run on one-minute prices. None of them predict the future. They're starting points with different temperaments.</p>
            <div className="docs-strats">
              {STRAT_KEYS.map((k) => {
                const s = STRATS[k];
                return (
                  <div key={k} className="docs-strat">
                    <pre aria-hidden="true">{spriteText(k, "idle", 1, true)}</pre>
                    <div>
                      <h3>{s.label}</h3>
                      <p>{s.desc}</p>
                      <p className="note-sm">Rebalances every {s.cad >= 60 ? `${s.cad / 60}h` : `${s.cad} min`} · default universe: {s.uni.map((u) => KIND_LABEL[u]).join(", ")}</p>
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="note-sm">Every strategy waits for 30 minutes of price history on an asset before it will trade it.</p>
          </section>

          <section id="risk">
            <h2>Risk dial &amp; rebalancing</h2>
            <p>The risk dial (1–10) sets how much of the vault is invested; the rest stays in USDC.</p>
            <div className="mkts-wrap">
              <table className="docs-table">
                <thead><tr><th>Risk</th>{[1, 3, 5, 7, 10].map((r) => <th key={r} className="r">{r}</th>)}</tr></thead>
                <tbody className="num"><tr><td>Invested</td>{[1, 3, 5, 7, 10].map((r) => <td key={r} className="r">{Math.round(exposure(r) * 100)}%</td>)}</tr></tbody>
              </table>
            </div>
            <ul>
              <li><b>Position caps:</b> no single asset can exceed {(["xstock", "prestock", "stonk", "pair", "pump", "otc"] as AssetKind[]).map((k) => `${Math.round(POSITION_CAP[k] * 100)}% (${KIND_LABEL[k]})`).join(", ")} of the vault.</li>
              <li><b>Rebalance speed:</b> <em>Fast</em> checks twice as often as normal, <em>Patient</em> 2.5× less often (fewer trades, lower fees).</li>
              <li><b>Drift bands:</b> agents only trade when a position is meaningfully off target, so they don't churn on tiny moves. Trades under ${LIMITS.minTradeUsd} are skipped.</li>
              <li><b>Stop-losses:</b> checked every minute. A position is closed if it falls {(["xstock", "prestock", "stonk", "pair"] as AssetKind[]).map((k) => `${Math.round(RISK_RULES[k].stop * 100)}% (${k === "pair" ? "launchpad coins" : KIND_LABEL[k]})`).join(", ")} below its entry, then the asset is benched for 6 hours.</li>
              <li><b>Trailing take-profit:</b> once a position is up by its arm level (e.g. {Math.round(RISK_RULES.xstock.arm * 100)}% on xStocks), it's sold if it gives back {Math.round(RISK_RULES.xstock.trail * 100)}% from its high.</li>
              <li><b>Minimum hold:</b> Momentum holds new positions at least {MIN_HOLD_MIN.MOMENTUM / 60}h and Reversion {MIN_HOLD_MIN.MEANREV / 60}h (risk exits excepted), so a flickering signal doesn't burn fees.</li>
              <li><b>Risk-off:</b> when SPYx is falling over 4 hours, agents halve their exposure to everything except xStocks.</li>
              <li>You can change risk or pause an agent from its desk at any time. A paused agent keeps its positions but stops trading.</li>
            </ul>
          </section>

          <section id="universe">
            <h2>What agents can trade</h2>
            <p>When you spawn an agent you choose which of these it may touch. Launchpad coins are rescanned every minute.</p>
            <div className="mkts-wrap">
              <table className="docs-table">
                <thead><tr><th>Type</th><th>What it is</th></tr></thead>
                <tbody>
                  {(["xstock", "prestock", "pair", "pump", "otc", "stonk"] as AssetKind[]).map((k) => (
                    <tr key={k}><td><span className={"kind k-" + k}>{KIND_LABEL[k]}</span></td><td style={{ whiteSpace: "normal" }}>{KIND_DESC[k]}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p>A launchpad coin only joins the universe if it clears a minimum market cap and 24h volume <b>and</b> a $10 test trade through Jupiter succeeds. Coins that fall below the bar are dropped from new trades.</p>
          </section>

          <section id="fees">
            <h2>Fees &amp; limits</h2>
            <ul>
              <li><b>No Stock Quant fee.</b> The platform doesn't take a cut of deposits, trades or profits.</li>
              <li><b>Pool fees</b> are paid to the liquidity pools a trade routes through (for example 0.25% on stonk.fun's Raydium pools). They're included in every quote.</li>
              <li><b>Network fees</b> come out of the agent's SOL balance. If it drops below {LIMITS.minGasSol} SOL the agent pauses itself until you top up.</li>
              <li><b>Slippage limits:</b> {LIMITS.slippageBpsStock / 100}% on stocks, {LIMITS.slippageBpsPair / 100}% on launchpad coins. Any trade whose price impact is above {LIMITS.maxPriceImpactPct}% is skipped.</li>
              <li><b>Beta caps:</b> ${LIMITS.maxDepositUsd} per agent, {LIMITS.maxAgentsPerWallet} agents per wallet, at most {LIMITS.maxOrdersPerRebalance} trades per rebalance.</li>
            </ul>
          </section>

          <section id="withdraw">
            <h2>Withdrawing</h2>
            <p>Open your agent's desk and click <em>Withdraw &amp; retire</em>, then confirm. The agent:</p>
            <ol>
              <li>sells every position back to USDC,</li>
              <li>sends the USDC to your wallet (anything it couldn't sell is sent as-is),</li>
              <li>closes its empty token accounts to recover rent, and</li>
              <li>sends the remaining SOL back to you.</li>
            </ol>
            <p>It usually takes a minute or two. The agent is then retired and every step is linked in its log.</p>
          </section>

          <section id="faq">
            <h2>FAQ</h2>
            <details><summary>Why hasn't my agent traded yet?</summary><p>Strategies need 30 minutes of price history first, and most only act when their rule fires: Momentum needs a positive hourly trend, Reversion needs a dip, Pair Sniper needs a breakout. Index Hugger and Pre-IPO Prophet trade soonest. The desk log explains what the agent is waiting for.</p></details>
            <details><summary>Can I add more USDC later?</summary><p>Yes. Open the desk and use <em>Top up</em>. Deposits made through the app count toward your P&amp;L baseline. Funds sent to the vault from elsewhere still work, but aren't counted as a deposit.</p></details>
            <details><summary>What happens if a trade fails?</summary><p>It's logged in red on the desk and retried on the next rebalance. Nothing is lost; the USDC simply stays in the vault.</p></details>
            <details><summary>Does a tokenized stock make me a shareholder?</summary><p>No. Tokenized stocks and stock-paired coins track prices but carry no voting, dividend or ownership rights in the company.</p></details>
            <details><summary>What are the SIM agents on the floor?</summary><p>They're simulated agents, one per strategy, that paper-trade on the same live prices with $1,000 of pretend USDC. They run conservative presets (low risk, patient rebalancing, liquid assets) that any real agent can also choose, and the same risk rules as real agents. They show how each strategy behaves, including when it loses. They hold no funds, never trade on-chain, and are left out of the platform totals (assets, P&amp;L, trades, volume). They're always tagged SIM with a dashed border.</p></details>
            <details><summary>Who can see my agent?</summary><p>Everyone. The floor shows every agent, its strategy and P&amp;L, and the vault address is public on Solana. Only you can control it or withdraw from it.</p></details>
          </section>

          <section id="risks">
            <h2>Risks &amp; regions</h2>
            <div className="banner">Agents trade real funds on Solana mainnet and can lose some or all of them. Strategies are simple rules, not financial advice. Launchpad coins are community launches and can go to zero quickly. Smart contracts, issuers, routers and key-management services can fail.</div>
            <p>xStocks and PreStocks are not offered to persons in restricted jurisdictions, including the United States. Spawning and deposits are blocked from restricted regions. You're responsible for following the rules where you live.</p>
          </section>
        </main>
      </div>
    </div>
  );
}
