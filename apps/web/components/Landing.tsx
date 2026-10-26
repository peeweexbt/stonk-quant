"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { KIND_LABEL, STRATS, STRAT_KEYS, exposure, type AssetKind, type StratKey } from "@stonkquant/core";
import { Sprite, type Mood } from "./Sprite";
import { asciiCandles, asciiSpark, figlet, sparkSvg } from "./chart";
import { COLORS, cls, hhmm, pct, price, usd, usdShort } from "./format";

interface Market { mint: string; sym: string; name: string; kind: AssetKind; quote_sym: string | null; price: number; ch1h: number; spark: number[] }
interface Agent { id: number; name: string; strat: StratKey; status: string; equity_usd: number; deposited_usd: number; withdrawn_usd: number; spark: number[]; sim?: boolean; color: number; trades: number; note: string | null }
interface FeedItem { id: string; ts: string; type: string; text: string; name: string; color: number; sim?: boolean }
interface State { markets: Market[]; agents: Agent[]; feed: FeedItem[]; stats: { live: number; active: number; sims?: number; aum: number; trades: number; volume: number; assets: number } }

const SPY = "XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W";
const KIND_ORDER: AssetKind[] = ["xstock", "prestock", "pair", "pump", "otc", "stonk"];
const KIND_BLURB: Record<AssetKind, string> = {
  xstock: "Tokenized US stocks & ETFs",
  prestock: "Pre-IPO exposure tokens",
  pair: "stonk.fun coins quoted in stocks",
  pump: "pump.fun custom stock pairs",
  otc: "OTC coins that pay in stocks",
  stonk: "stonk.fun platform token",
};

/** Adds .in to [data-reveal] elements as they scroll into view. Content stays visible without JS. */
function useReveal() {
  useEffect(() => {
    document.documentElement.classList.add("js-reveal");
    const els = [...document.querySelectorAll<HTMLElement>("[data-reveal]")];
    if (!("IntersectionObserver" in window)) { els.forEach((e) => e.classList.add("in")); return; }
    const io = new IntersectionObserver((entries) => entries.forEach((en) => { if (en.isIntersecting) { en.target.classList.add("in"); io.unobserve(en.target); } }), { threshold: 0.15 });
    els.forEach((e) => io.observe(e));
    return () => io.disconnect();
  }, []);
}

/** Types out lines like a terminal, then holds. */
function Typer({ lines, speed = 22 }: { lines: string[]; speed?: number }) {
  const [n, setN] = useState(0);
  const total = useMemo(() => lines.join("\n").length, [lines]);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { setN(total); return; }
    const t = setInterval(() => setN((x) => (x >= total ? x : x + 1)), speed);
    return () => clearInterval(t);
  }, [total, speed]);
  const text = lines.join("\n").slice(0, n);
  return <pre className="typer" aria-label={lines.join(" ")}>{text}<span className="caret">█</span></pre>;
}

function Counter({ value, format }: { value: number; format: (n: number) => string }) {
  const [v, setV] = useState(0);
  const from = useRef(0);
  useEffect(() => {
    const start = performance.now(), a = from.current, b = value, dur = 900;
    let raf = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - start) / dur), e = 1 - Math.pow(1 - k, 3);
      setV(a + (b - a) * e);
      if (k < 1) raf = requestAnimationFrame(step); else from.current = b;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <>{format(v)}</>;
}

export default function Landing() {
  const [state, setState] = useState<State | null>(null);
  const [candles, setCandles] = useState<number[]>([]);
  useReveal();

  useEffect(() => {
    let alive = true;
    const load = () => fetch("/api/state").then((r) => r.json()).then((d) => alive && d.markets && setState(d)).catch(() => {});
    const loadC = () => fetch(`/api/candles?mint=${SPY}`).then((r) => r.json()).then((d) => alive && setCandles(d.points ?? [])).catch(() => {});
    load(); loadC();
    const t = setInterval(load, 10_000), t2 = setInterval(loadC, 30_000);
    return () => { alive = false; clearInterval(t); clearInterval(t2); };
  }, []);

  const markets = state?.markets ?? [];
  const agents = state?.agents ?? [];
  const sims = agents.filter((a) => a.sim);
  const byKind = useMemo(() => {
    const m: Partial<Record<AssetKind, Market[]>> = {};
    for (const x of markets) (m[x.kind] ??= []).push(x);
    return m;
  }, [markets]);
  const spy = markets.find((m) => m.mint === SPY);

  return (
    <div className="landing">
      <header className="topbar l-top">
        <a href="/" className="brand" style={{ textDecoration: "none" }}>STOCK<span>_QUANT</span></a>
        <nav className="nav" aria-label="Sections">
          <a href="#how">How it works</a><a href="#agents">Agents</a><a href="#universe">Universe</a><a href="#custody">Custody</a><a href="/docs">Docs</a><a href="/app">Floor</a>
        </nav>
        <div className="spacer" />
        <a className="btn ghost" href="/app" style={{ textDecoration: "none" }}>Launch app</a>
        <a className="btn" href="/app#spawn" style={{ textDecoration: "none" }}>Spawn agent</a>
      </header>

      {/* tape */}
      <div className="tape" aria-hidden="true">
        <div className="tape-inner num">
          {(markets.length ? [0, 1] : [0]).map((rep) =>
            (markets.length ? markets.slice(0, 30) : []).map((a) => (
              <span key={rep + a.mint}><b>{a.sym}</b>{price(a.price)} <span className={cls(a.ch1h)}>{a.ch1h >= 0 ? "▲" : "▼"} {pct(a.ch1h)}</span></span>
            )),
          )}
          {!markets.length && <span>connecting to the floor…</span>}
        </div>
      </div>

      {/* hero */}
      <section className="l-hero">
        <div className="l-hero-copy">
          <pre className="logo l-logo" aria-label="Stock Quant">{figlet("STOCK")}{"\n"}<span className="q">{figlet("QUANT")}</span></pre>
          <Typer lines={[
            "> spawning agent… ok",
            "> vault created · keys sealed in Turnkey",
            "> scanning xStocks, PreStocks, stonk.fun, pump.fun, OTC…",
            "> agent online. trading tokenized stocks for you.",
          ]} />
          <div className="l-cta">
            <a className="btn l-big" href="/app#spawn">Spawn an agent</a>
            <a className="btn ghost l-big" href="#how">See how it works ↓</a>
          </div>
        </div>
        <div className="l-hero-stats" data-reveal>
          <div className="stats">
            <div className="stat"><div className="k">Assets under agents</div><div className="v num">{state ? <Counter value={state.stats.aum} format={usdShort} /> : "—"}</div></div>
            <div className="stat"><div className="k">Agents live</div><div className="v num">{state ? <Counter value={state.stats.live} format={(n) => String(Math.round(n))} /> : "—"}</div></div>
            <div className="stat"><div className="k">Sim agents</div><div className="v num">{state ? <Counter value={state.stats.sims ?? 0} format={(n) => String(Math.round(n))} /> : "—"}</div></div>
            <div className="stat"><div className="k">Assets tracked</div><div className="v num" style={{ color: "var(--fire)" }}>{state ? <Counter value={state.stats.assets} format={(n) => String(Math.round(n))} /> : "—"}</div></div>
          </div>
          <div className="frame l-chart">
            <span className="tag">SPYx · live</span>
            <span className="tag-r">{spy ? price(spy.price) : ""}</span>
            {candles.length >= 9
              ? <pre className="ascii-chart num" dangerouslySetInnerHTML={{ __html: asciiCandles(candles, sims.find((a) => a.strat === "INDEX")?.name ?? null, 40, 11, 3) }} />
              : <div className="collecting">warming up the tape…</div>}
          </div>
        </div>
      </section>

      {/* parade */}
      <div className="l-parade" aria-hidden="true">
        <div className="l-parade-track">
          {[...STRAT_KEYS, ...STRAT_KEYS].map((k, i) => (
            <div key={i} className="l-walker" style={{ ["--agent" as any]: COLORS[i % COLORS.length], animationDelay: `${-i * 2.2}s` }}>
              <Sprite strat={k} mood={(["idle", "happy", "trade", "idle", "happy", "sad"] as Mood[])[i % 6]} />
            </div>
          ))}
        </div>
      </div>

      {/* how */}
      <section id="how" className="l-section">
        <p className="l-eyebrow">How it works</p>
        <h2 className="l-h2" data-reveal>Five steps from wallet to trading desk</h2>
        <div className="l-steps">
          {[
            ["Connect", "Sign in with Phantom. One signature proves the wallet is yours. No gas, no funds moved.", "idle"],
            ["Spawn", "Pick a strategy, a risk level and what it may trade. Your agent gets its own personality and its own wallet.", "boot"],
            ["Fund", "Send USDC plus a little SOL for fees straight from Phantom into the agent's vault.", "happy"],
            ["Trade", "Every minute it reads prices, decides, and swaps through Jupiter. Every move lands in its log with a Solscan link.", "trade"],
            ["Withdraw", "One click sells to USDC and sends everything back to the wallet that owns it.", "happy"],
          ].map(([t, d, mood], i) => (
            <div key={t} className="l-step" data-reveal style={{ transitionDelay: `${i * 80}ms` }}>
              <div className="l-step-n">{String(i + 1).padStart(2, "0")}</div>
              <Sprite strat={STRAT_KEYS[i % STRAT_KEYS.length]} mood={mood as Mood} />
              <h3>{t}</h3>
              <p>{d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* agents */}
      <section id="agents" className="l-section">
        <p className="l-eyebrow">Meet the agents</p>
        <h2 className="l-h2" data-reveal>Six temperaments. Pick one, or run them all.</h2>
        <p className="l-lede" data-reveal>Each strategy is a simple, transparent rule. The SIM agents below paper-trade every strategy on live prices right now, so you can watch them before you fund one.</p>
        <div className="l-agents">
          {STRAT_KEYS.map((k, i) => {
            const s = STRATS[k];
            const sim = sims.find((a) => a.strat === k);
            const base = sim ? sim.deposited_usd - sim.withdrawn_usd : 0;
            const r = sim && base > 0 ? sim.equity_usd / base - 1 : 0;
            return (
              <div key={k} className="l-agent" data-reveal style={{ ["--agent" as any]: COLORS[i % COLORS.length], transitionDelay: `${i * 60}ms` }}>
                <Sprite strat={k} mood={sim ? (r > 0.001 ? "happy" : r < -0.001 ? "sad" : "idle") : "idle"} />
                <div className="l-agent-body">
                  <h3>{s.label}</h3>
                  <p>{s.desc}</p>
                  <p className="note-sm">Rebalances every {s.cad >= 60 ? `${s.cad / 60}h` : `${s.cad} min`}</p>
                  {sim && (
                    <div className="l-sim">
                      <span className="pill sim">sim</span>
                      <span className="num">{usd(sim.equity_usd)}</span>
                      <span className={"num " + cls(r)}>{pct(r)}</span>
                      <span className="l-sim-spark" dangerouslySetInnerHTML={{ __html: sparkSvg(sim.spark, r >= 0 ? "var(--up)" : "var(--down)", 120, 24) }} />
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        <div className="frame l-risk" data-reveal>
          <span className="tag">Risk dial</span>
          <p>The dial sets how much of the vault is invested. The rest waits in USDC.</p>
          <div className="l-dial">
            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
              <div key={n} className="l-dial-col">
                <div className="l-dial-bar" style={{ height: `${Math.round(exposure(n) * 100)}%` }} />
                <span className="num">{n}</span>
              </div>
            ))}
          </div>
          <p className="note-sm">Risk 1 invests {Math.round(exposure(1) * 100)}%, risk 10 invests 100%. No single coin can take over a vault.</p>
        </div>
      </section>

      {/* universe */}
      <section id="universe" className="l-section">
        <p className="l-eyebrow">The universe</p>
        <h2 className="l-h2" data-reveal>Stocks on-chain, and everything launched against them</h2>
        <p className="l-lede" data-reveal>Agents trade tokenized stocks plus the stock-paired coins tied to them. New coins are scanned every minute, and only the liquid ones that pass a live test trade make the cut.</p>
        <div className="l-kinds">
          {KIND_ORDER.map((k, i) => {
            const list = byKind[k] ?? [];
            return (
              <div key={k} className="l-kind" data-reveal style={{ transitionDelay: `${i * 60}ms` }}>
                <div className="l-kind-head"><span className={"kind k-" + k}>{KIND_LABEL[k]}</span><span className="num l-kind-n">{list.length || "—"}</span></div>
                <p>{KIND_BLURB[k]}</p>
                <div className="l-kind-syms num">
                  {list.slice(0, 6).map((m) => <span key={m.mint}><b>{m.sym}</b> <span className={cls(m.ch1h)}>{asciiSpark(m.spark.slice(-8))}</span></span>)}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* custody */}
      <section id="custody" className="l-section">
        <p className="l-eyebrow">Custody</p>
        <h2 className="l-h2" data-reveal>Your agent can swap. It can't run off.</h2>
        <div className="l-custody">
          <pre className="l-flow" data-reveal aria-label="Funds flow from your wallet to the agent vault, which can only swap through Jupiter or send back to you">{`  ┌──────────────┐        deposit        ┌──────────────────┐
  │  YOUR WALLET │ ════════════════════▶ │   AGENT VAULT    │
  │   (Phantom)  │ ◀════════════════════ │ keys in Turnkey  │
  └──────────────┘   withdraw: only you  └────────┬─────────┘
                                                   │ swaps only
                                          ┌────────▼─────────┐
                                          │     JUPITER      │
                                          │ Raydium · Pump · │
                                          │ Meteora · Orca   │
                                          └──────────────────┘`}<span className="l-packet" /></pre>
          <ul className="l-bullets" data-reveal>
            <li><b>One vault per agent.</b> No shared pool, and every vault is public on Solana.</li>
            <li><b>Keys never touch the website.</b> They live in Turnkey's secure enclaves.</li>
            <li><b>Swap-only signing.</b> A policy lets the trading key sign Jupiter swaps with zero direct transfers.</li>
            <li><b>Owner-only exits.</b> Withdrawals are locked to the wallet that funded the agent.</li>
            <li><b>No platform fee.</b> You pay pool fees and Solana gas, nothing else.</li>
          </ul>
        </div>
      </section>

      {/* tape */}
      <section className="l-section">
        <p className="l-eyebrow">Right now</p>
        <h2 className="l-h2" data-reveal>The floor, live</h2>
        <div className="frame l-feed" data-reveal>
          <span className="tag">Live tape</span>
          <div className="feed num">
            {(state?.feed ?? []).slice(0, 10).map((e) => (
              <div key={e.id}><span className="t">{hhmm(e.ts)}</span><span className="who" style={{ color: COLORS[e.color % COLORS.length] }}>{e.name}{e.sim ? " ·sim" : ""}</span><span className={e.type === "buy" ? "buy" : e.type === "sell" || e.type === "err" ? "sell" : "evt"}>{e.text}</span></div>
            ))}
            {!state?.feed?.length && <div><span /><span /><span className="muted">Waiting for the first trades of the session…</span></div>}
          </div>
        </div>
      </section>

      {/* final */}
      <section className="l-final" data-reveal>
        <Sprite strat="MOMENTUM" mood="happy" className="sprite l-final-sprite" />
        <h2 className="l-h2">Put an agent on the floor</h2>
        <p className="l-lede">Spawn one in under a minute. Start small, watch it trade, withdraw whenever you like.</p>
        <div className="l-cta" style={{ justifyContent: "center" }}>
          <a className="btn l-big" href="/app#spawn">Launch app</a>
          <a className="btn ghost l-big" href="/docs">Read the docs</a>
        </div>
      </section>

      <p className="foot l-foot">
        Agents trade real funds on Solana mainnet and can lose some or all of them. Strategies are simple rules, not financial advice. Tokenized stocks carry no shareholder rights. xStocks and PreStocks are not offered to persons in restricted jurisdictions, including the United States. Stock-paired coins are community-launched and can go to zero.
      </p>
    </div>
  );
}
