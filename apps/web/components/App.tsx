"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ALL_KINDS, KIND_LABEL, STRATS, STRAT_KEYS, isLaunchCoin, type AssetKind, type StratKey } from "@stonkquant/core";
import { Sprite, spriteText, type Mood } from "./Sprite";
import { asciiCandles, asciiSpark, figlet, sparkSvg } from "./chart";
import { COLORS, acctUrl, cls, hhmm, pct, price, qty, short, txUrl, usd, usdShort } from "./format";
import { api, sendDeposit, signIn, signOut } from "./wallet";

/* ---------------- types ---------------- */

interface Market { mint: string; sym: string; name: string; kind: AssetKind; quote_sym: string | null; price: number; ch1h: number; spark: number[] }
interface Holding { sym: string; ui: number; value: number; price: number; entry?: number }
interface Agent {
  id: number; owner: string; name: string; strat: StratKey; risk: number; color: number; status: string; address: string | null;
  deposited_usd: number; withdrawn_usd: number; equity_usd: number; cash_usd: number; sol_balance: number;
  holdings: Record<string, Holding>; note: string | null; trades: number; volume_usd: number; created_at: string;
  spark: number[]; last: { type: string; text: string; ts: string } | null;
}
interface FeedItem { id: string; ts: string; type: string; text: string; sig: string | null; agent_id: number; name: string; color: number }
interface State { now: string; markets: Market[]; agents: Agent[]; feed: FeedItem[]; stats: { live: number; active: number; aum: number; pnl: number; trades: number; volume: number; assets: number } }
interface Me { wallet: string | null; restricted: { country: string; message: string } | null; limits: { gasSol: number; minDepositUsd: number; maxDepositUsd: number; maxAgents: number } }

const SPY = "XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W";
const UNI_LABEL: Record<AssetKind, string> = { xstock: "xStocks", prestock: "PreStocks", pair: "stonk.fun pairs", pump: "pump.fun pairs", otc: "OTC desk coins", stonk: "STONK" };
const STATUS_PILL: Record<string, [string, string]> = {
  provisioning: ["boot", "creating vault"], awaiting_deposit: ["wait", "needs deposit"], live: ["live", "live"],
  paused: ["paused", "paused"], withdrawing: ["wait", "withdrawing"], retired: ["out", "retired"],
};

function moodOf(a: Agent): Mood {
  if (a.status === "provisioning" || a.status === "awaiting_deposit" || a.status === "withdrawing") return "boot";
  if (a.status === "paused") return "sleep";
  if (a.last && (a.last.type === "buy" || a.last.type === "sell") && Date.now() - new Date(a.last.ts).getTime() < 3 * 60_000) return "trade";
  const s = a.spark;
  if (s.length >= 3) {
    const d = s[s.length - 1] / s[s.length - 3] - 1;
    if (d > 0.001) return "happy";
    if (d < -0.001) return "sad";
  }
  return "idle";
}
const pnlOf = (a: Agent) => {
  const base = a.deposited_usd - a.withdrawn_usd;
  return base > 0 ? { abs: a.equity_usd - base, rel: a.equity_usd / base - 1 } : { abs: 0, rel: 0 };
};

/* ---------------- root ---------------- */

export default function App() {
  const [state, setState] = useState<State | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [chartMint, setChartMint] = useState(SPY);
  const [openId, setOpenId] = useState<number | null>(null);
  const [filter, setFilter] = useState<"ALL" | "MINE" | StratKey>("ALL");
  const [toast, setToast] = useState<{ msg: string; err?: boolean } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>();

  const notify = useCallback((msg: string, err = false) => {
    setToast({ msg, err });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 6000);
  }, []);

  const loadState = useCallback(async () => {
    try { setState(await api<State>("/api/state")); } catch (e) { console.warn(e); }
  }, []);
  const loadMe = useCallback(async () => {
    try { setMe(await api<Me>("/api/me")); } catch (e) { console.warn(e); }
  }, []);

  useEffect(() => {
    loadState(); loadMe();
    const t = setInterval(loadState, 6000);
    const id = Number(location.hash.replace(/^#agent-/, ""));
    if (Number.isInteger(id) && id > 0) setOpenId(id);
    return () => clearInterval(t);
  }, [loadState, loadMe]);

  const closeDesk = useCallback(() => { setOpenId(null); history.replaceState(null, "", location.pathname); }, []);

  const doSignIn = async () => {
    try { await signIn(); await loadMe(); notify("Signed in"); }
    catch (e) { notify((e as Error).message, true); }
  };
  const doSignOut = async () => { await signOut(); await loadMe(); notify("Signed out"); };

  const markets = state?.markets ?? [];
  const agents = state?.agents ?? [];
  const mine = me?.wallet ?? null;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">STOCK<span>_QUANT</span></div>
        <nav className="nav" aria-label="Sections"><a href="#floor">Agents</a><a href="#spawn">Spawn</a><a href="#markets">Markets</a></nav>
        <div className="spacer" />
        <div className="clock">{state ? <>LIVE <b className="num">{hhmm(state.now)}</b></> : "connecting…"}</div>
        <div className="wallet">
          {mine ? (
            <>
              <span className="bal num">{short(mine)}</span>
              <button className="btn ghost" type="button" onClick={doSignOut}>Sign out</button>
            </>
          ) : (
            <button className="btn ghost" type="button" onClick={doSignIn}>Connect Phantom</button>
          )}
        </div>
      </header>

      <Tape markets={markets} />

      {me?.restricted && <div className="banner" role="status">{me.restricted.message} (detected region: {me.restricted.country})</div>}

      <section className="hero">
        <div className="hero-left">
          <pre className="logo" aria-label="Stock Quant">{figlet("STOCK")}{"\n"}<span className="q">{figlet("QUANT")}</span></pre>
          <p className="pitch">Spawn an agent, fund its vault, and it trades <em>tokenized stocks</em> and <em>stock-paired coins</em> from stonk.fun, pump.fun and OTC desks on Solana for you. Every agent has its own strategy, wallet and risk dial, and you can withdraw any time.</p>
          <div className="stats">
            <Stat k="Assets under agents" v={state ? usdShort(state.stats.aum) : "—"} />
            <Stat k="Net P&L" v={state ? (state.stats.pnl >= 0 ? "+" : "") + usd(state.stats.pnl, 0) : "—"} cls={state ? cls(state.stats.pnl) : ""} />
            <Stat k="Agents live" v={state ? `${state.stats.live}/${state.stats.active}` : "—"} />
            <Stat k="Trades" v={state ? state.stats.trades.toLocaleString() : "—"} />
            <Stat k="Volume routed" v={state ? usdShort(state.stats.volume) : "—"} />
            <Stat k="Assets tracked" v={state ? String(state.stats.assets) : "—"} style={{ color: "var(--fire)" }} />
          </div>
        </div>
        <ChartPanel markets={markets} agents={agents} mint={chartMint} setMint={setChartMint} />
      </section>

      <div className="main">
        <Floor agents={agents} mine={mine} filter={filter} setFilter={setFilter} onOpen={setOpenId} loaded={!!state} />
        <aside className="side">
          <Spawn me={me} onSignIn={doSignIn} notify={notify} onCreated={(id) => { setOpenId(id); loadState(); }} />
          <Feed feed={feed(state)} onOpen={setOpenId} />
        </aside>
      </div>

      <Markets markets={markets} agents={agents} mint={chartMint} setMint={setChartMint} />

      <p className="foot">
        Agents trade real funds on Solana mainnet through Jupiter routes, from vaults whose keys are held by Turnkey and locked by policy to swaps and to withdrawals back to your wallet.
        Strategies are simple rules, not advice, and can lose money. Holding a tokenized stock or a stock-paired coin carries no shareholder rights. xStocks and PreStocks are not offered to persons in restricted jurisdictions, including the United States.
        Launchpad coins (stonk.fun, pump.fun, OTC desks) are community launches and can go to zero.
      </p>

      {openId !== null && <Desk id={openId} me={me} notify={notify} onClose={closeDesk} onChanged={loadState} />}
      {toast && <div className={"toast" + (toast.err ? " err" : "")} role="status">{toast.msg}</div>}
    </div>
  );
}

const feed = (s: State | null) => s?.feed ?? [];

function Stat({ k, v, cls: c = "", style }: { k: string; v: string; cls?: string; style?: React.CSSProperties }) {
  return <div className="stat"><div className="k">{k}</div><div className={"v num " + c} style={style}>{v}</div></div>;
}

/* ---------------- tape ---------------- */

function Tape({ markets }: { markets: Market[] }) {
  const items = markets.slice(0, 28);
  if (!items.length) return <div className="tape" aria-hidden="true"><div className="tape-inner num"><span>loading prices…</span></div></div>;
  const row = (pre: string) => items.map((a) => (
    <span key={pre + a.mint}><b>{a.sym}</b>{price(a.price)} <span className={cls(a.ch1h)}>{a.ch1h >= 0 ? "▲" : "▼"} {pct(a.ch1h)}</span></span>
  ));
  return <div className="tape" aria-hidden="true"><div className="tape-inner num">{row("a")}{row("b")}</div></div>;
}

/* ---------------- chart ---------------- */

function ChartPanel({ markets, agents, mint, setMint }: { markets: Market[]; agents: Agent[]; mint: string; setMint: (m: string) => void }) {
  const [points, setPoints] = useState<number[]>([]);
  useEffect(() => {
    let alive = true;
    const load = () => api<{ points: number[] }>(`/api/candles?mint=${mint}`).then((d) => alive && setPoints(d.points)).catch(() => {});
    load();
    const t = setInterval(load, 20_000);
    return () => { alive = false; clearInterval(t); };
  }, [mint]);
  const m = markets.find((x) => x.mint === mint);
  const tabs = useMemo(() => {
    const pick = ["SPYx", "NVDAx", "OPENAI", "STONK"].map((s) => markets.find((x) => x.sym === s)).filter(Boolean) as Market[];
    const topPair = markets.find((x) => isLaunchCoin(x.kind));
    const list = topPair ? [...pick, topPair] : pick;
    if (m && !list.some((x) => x.mint === m.mint)) list.push(m);
    return list;
  }, [markets, m]);
  const holders = agents.filter((a) => (a.holdings?.[mint]?.value ?? 0) > 1);
  const leader = holders.slice().sort((a, b) => b.holdings[mint].value - a.holdings[mint].value)[0];
  const html = points.length >= 9 ? asciiCandles(points, leader?.name ?? null) : "";
  const ch = points.length > 60 ? points[points.length - 1] / points[points.length - 61] - 1 : m?.ch1h ?? 0;
  return (
    <div className="frame chart-frame">
      <span className="tag">Tape reader</span>
      <span className="tag-r">1 candle = 3 min</span>
      <div className="chart-head">
        <span className="sym">{m ? m.sym + (m.quote_sym ? "/" + m.quote_sym : "") : "—"}</span>
        <span className="px num">{price(m?.price ?? points[points.length - 1])}</span>
        <span className="sub num"><span className={cls(ch)}>{pct(ch)}</span> 1h</span>
        <div className="chart-tabs">
          {tabs.map((t) => <button key={t.mint} type="button" className="chip" aria-pressed={t.mint === mint} onClick={() => setMint(t.mint)}>{t.sym}</button>)}
        </div>
      </div>
      {html ? <pre className="ascii-chart num" aria-label="Price chart" dangerouslySetInnerHTML={{ __html: html }} /> : <div className="collecting">Collecting price history ({points.length} min so far)…</div>}
      <div className="chart-foot">
        <span>{m ? `${m.name} · ${KIND_LABEL[m.kind]}` : ""}</span>
        <span>{holders.length ? `held by ${holders.map((a) => a.name).join(", ")}` : "no agents holding"}</span>
      </div>
    </div>
  );
}

/* ---------------- floor ---------------- */

function Floor({ agents, mine, filter, setFilter, onOpen, loaded }: { agents: Agent[]; mine: string | null; filter: string; setFilter: (f: any) => void; onOpen: (id: number) => void; loaded: boolean }) {
  const shown = agents.filter((a) => filter === "ALL" || (filter === "MINE" ? a.owner === mine : a.strat === filter));
  const opts: [string, string][] = [["ALL", "All"], ...(mine ? [["MINE", "Mine"] as [string, string]] : []), ...STRAT_KEYS.map((k) => [k, STRATS[k].label.split(" ")[0]] as [string, string])];
  return (
    <section id="floor">
      <div className="floor-head">
        <h2>The floor</h2>
        <span className="muted">Every agent's vault is public on-chain. Click one to open its desk.</span>
        <div className="filters">{opts.map(([k, l]) => <button key={k} type="button" className="chip" aria-pressed={k === filter} onClick={() => setFilter(k)}>{l}</button>)}</div>
      </div>
      <div className="agents">
        {shown.map((a) => <AgentCard key={a.id} a={a} mine={a.owner === mine} onOpen={() => onOpen(a.id)} />)}
        {loaded && !shown.length && <div className="empty">{filter === "MINE" ? "You don't have any agents yet. Spawn one from the panel." : "No agents on the floor yet. Spawn the first one."}</div>}
      </div>
    </section>
  );
}

function AgentCard({ a, mine, onOpen }: { a: Agent; mine: boolean; onOpen: () => void }) {
  const p = pnlOf(a);
  const [pc, label] = STATUS_PILL[a.status] ?? ["out", a.status];
  const color = COLORS[a.color % COLORS.length];
  const hs = Object.entries(a.holdings ?? {}).filter(([, h]) => h.value > 0.5).sort((x, y) => y[1].value - x[1].value).slice(0, 4);
  const thought = a.status === "awaiting_deposit" ? "waiting for a USDC + SOL deposit" : a.status === "provisioning" ? "creating vault…" : a.note || a.last?.text || "warming up";
  return (
    <button type="button" className={"agent" + (a.status === "paused" ? " paused" : "") + (mine ? " mine" : "")} style={{ ["--agent" as any]: color }} onClick={onOpen}>
      <div className="row"><span className="nm">{a.name}</span><span className={"pill " + pc}>{label}</span>{mine && <span className="mine-tag">YOURS</span>}</div>
      <div className="strat">{STRATS[a.strat]?.label} · risk {a.risk}{a.address ? ` · ${short(a.address)}` : ""}</div>
      <div className="body">
        <Sprite strat={a.strat} mood={moodOf(a)} />
        <div style={{ minWidth: 0 }}>
          <div className="eq num">{usd(a.equity_usd)}</div>
          <div className={"pnl num " + cls(p.abs)}>{pct(p.rel)} ({usd(p.abs)})</div>
          <div dangerouslySetInnerHTML={{ __html: sparkSvg(a.spark, p.abs >= 0 ? "var(--up)" : "var(--down)") }} />
        </div>
      </div>
      <div className="holds">
        {hs.length ? hs.map(([m, h]) => <span key={m}><b>{h.sym}</b> {a.equity_usd > 0 ? ((h.value / a.equity_usd) * 100).toFixed(0) : 0}%</span>) : <span>{a.cash_usd > 0 ? "100% USDC" : "empty vault"}</span>}
      </div>
      <div className="thought">{thought}</div>
    </button>
  );
}

/* ---------------- spawn ---------------- */

function Spawn({ me, onSignIn, notify, onCreated }: { me: Me | null; onSignIn: () => void; notify: (m: string, e?: boolean) => void; onCreated: (id: number) => void }) {
  const [name, setName] = useState("");
  const [strat, setStrat] = useState<StratKey>("MOMENTUM");
  const [uni, setUni] = useState<AssetKind[]>(STRATS.MOMENTUM.uni);
  const [risk, setRisk] = useState(5);
  const [cad, setCad] = useState("1");
  const [terms, setTerms] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => { setName(["GRIDLOCK", "BETA-MAX", "THETA", "DIP-9", "SHARPE", "KELLY", "VWAP-3", "ALPHA-7", "BAGWORK", "GAMMA"][Math.floor(Math.random() * 10)] + "-" + Math.floor(Math.random() * 90 + 10)); }, []);

  const pickStrat = (k: StratKey) => { setStrat(k); setUni(STRATS[k].uni); };
  const toggle = (k: AssetKind) => setUni((u) => (u.includes(k) ? u.filter((x) => x !== k) : [...u, k]));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr("");
    if (!me?.wallet) { onSignIn(); return; }
    if (!uni.length) { setErr("Allow at least one asset type."); return; }
    if (!terms) { setErr("Please read and accept the risk disclosure."); return; }
    setBusy(true);
    try {
      const { id } = await api<{ id: number }>("/api/agents", { method: "POST", body: JSON.stringify({ name, strat, risk, uni, cadenceMul: Number(cad), acceptTerms: true }) });
      notify(`${name.toUpperCase()} spawned. Its vault is being created.`);
      onCreated(id);
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };

  const restricted = !!me?.restricted;
  return (
    <section className="frame spawn" id="spawn">
      <span className="tag">Spawn agent</span>
      <form onSubmit={submit} noValidate>
        <div className="field">
          <label htmlFor="fName">Agent handle</label>
          <input className="input" id="fName" maxLength={14} autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="field">
          <span className="lbl" id="stratLbl">Strategy</span>
          <div className="strats" role="radiogroup" aria-labelledby="stratLbl">
            {STRAT_KEYS.map((k) => (
              <div className="strat-opt" key={k}>
                <input type="radio" name="strat" id={"st-" + k} value={k} checked={strat === k} onChange={() => pickStrat(k)} />
                <label htmlFor={"st-" + k}><pre aria-hidden="true">{spriteText(k, "idle", 1, true)}</pre><span><b>{STRATS[k].label}</b><small>{STRATS[k].desc}</small></span></label>
              </div>
            ))}
          </div>
        </div>
        <div className="field">
          <span className="lbl">Allowed universe</span>
          <div className="checks">
            {ALL_KINDS.map((k) => (
              <label key={k}><input type="checkbox" id={"u-" + k} checked={uni.includes(k)} onChange={() => toggle(k)} /> {UNI_LABEL[k]}</label>
            ))}
          </div>
        </div>
        <div className="field">
          <label htmlFor="fRisk">Risk dial</label>
          <div className="range-row"><input type="range" id="fRisk" min={1} max={10} value={risk} onChange={(e) => setRisk(Number(e.target.value))} /><output htmlFor="fRisk">{risk} · {Math.round((0.3 + 0.07 * risk) * 100)}% invested</output></div>
        </div>
        <div className="field">
          <label htmlFor="fCad">Rebalance speed</label>
          <select className="input" id="fCad" value={cad} onChange={(e) => setCad(e.target.value)}>
            <option value="0.5">Fast (2× as often)</option>
            <option value="1">Normal</option>
            <option value="2.5">Patient (fewer trades, lower fees)</option>
          </select>
        </div>
        <label className="terms" htmlFor="fTerms">
          <input type="checkbox" id="fTerms" checked={terms} onChange={(e) => setTerms(e.target.checked)} />
          <span>I understand this agent trades real funds automatically, can lose some or all of them, and that tokenized stocks give no shareholder rights. I'm not a person in a restricted jurisdiction.</span>
        </label>
        <p className="err" role="alert">{err}</p>
        {restricted ? (
          <button className="btn" type="button" disabled>Not available in your region</button>
        ) : (
          <button className="btn" type="submit" disabled={busy}>{me?.wallet ? (busy ? "Spawning…" : "Spawn agent") : "Connect Phantom to spawn"}</button>
        )}
        <p className="note-sm">After spawning you'll fund the agent's vault with USDC plus {me?.limits.gasSol ?? 0.03} SOL for fees. Deposits up to ${me?.limits.maxDepositUsd ?? 1000} per agent during beta.</p>
      </form>
    </section>
  );
}

/* ---------------- feed ---------------- */

function Feed({ feed, onOpen }: { feed: FeedItem[]; onOpen: (id: number) => void }) {
  const kind: Record<string, string> = { buy: "buy", sell: "sell", evt: "evt", boot: "evt", err: "sell" };
  return (
    <section className="frame">
      <span className="tag">Live tape</span>
      <span className="tag-r">{feed.length ? "latest " + feed.length : "quiet"}</span>
      <div className="feed num">
        {feed.map((e) => (
          <div key={e.id}>
            <span className="t">{hhmm(e.ts)}</span>
            <button type="button" className="who" style={{ color: COLORS[e.color % COLORS.length], background: "none", border: 0, padding: 0, textAlign: "left", font: "inherit" }} onClick={() => onOpen(e.agent_id)}>{e.name}</button>
            <span className={kind[e.type] || ""}>{e.text}{e.sig && <> · <a className="sig" href={txUrl(e.sig)} target="_blank" rel="noreferrer">tx</a></>}</span>
          </div>
        ))}
        {!feed.length && <div><span /><span /><span className="muted">No trades yet.</span></div>}
      </div>
    </section>
  );
}

/* ---------------- markets ---------------- */

function Markets({ markets, agents, mint, setMint }: { markets: Market[]; agents: Agent[]; mint: string; setMint: (m: string) => void }) {
  return (
    <section className="frame" id="markets">
      <span className="tag">Markets</span>
      <span className="tag-r">click a row to chart it</span>
      <div className="sec-head">
        <h2 className="sec-title">Stock universe</h2>
        <span className="muted">Tokenized stocks plus the most liquid launchpad coins tied to them: stonk.fun pairs, pump.fun custom pairs and OTC desk coins that pay holders in stocks.</span>
      </div>
      <div className="mkts-wrap">
        <table>
          <thead><tr><th>Asset</th><th>Type</th><th>Quoted in</th><th className="r">Price</th><th className="r">1h</th><th>Last 60m</th><th className="r">Held by</th></tr></thead>
          <tbody className="num">
            {markets.map((a) => {
              const n = agents.filter((g) => (g.holdings?.[a.mint]?.value ?? 0) > 1).length;
              return (
                <tr key={a.mint} className={a.mint === mint ? "sel" : ""} onClick={() => { setMint(a.mint); document.querySelector(".chart-frame")?.scrollIntoView({ behavior: "smooth", block: "center" }); }}>
                  <td className="sym-cell"><b>{a.sym}</b> <span className="muted">{a.name}</span></td>
                  <td><span className={"kind k-" + a.kind}>{KIND_LABEL[a.kind]}</span></td>
                  <td>{a.kind === "otc" ? `pays ${a.quote_sym}` : a.quote_sym || "USD"}</td>
                  <td className="r">{price(a.price)}</td>
                  <td className={"r " + cls(a.ch1h)}>{pct(a.ch1h)}</td>
                  <td className={"spark " + cls(a.ch1h)}>{asciiSpark(a.spark)}</td>
                  <td className="r">{n ? `${n} agent${n > 1 ? "s" : ""}` : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/* ---------------- desk ---------------- */

interface Detail { agent: Agent & { cadence_mul: number; uni: AssetKind[]; error: string | null }; events: { id: string; ts: string; type: string; text: string; sig: string | null }[]; equity: number[]; deposits: { sig: string; usdc: number; sol: number; ts: string }[] }

function Desk({ id, me, notify, onClose, onChanged }: { id: number; me: Me | null; notify: (m: string, e?: boolean) => void; onClose: () => void; onChanged: () => void }) {
  const [d, setD] = useState<Detail | null>(null);
  const [risk, setRisk] = useState<number | null>(null);
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [usdcAmt, setUsdcAmt] = useState("100");
  const [solAmt, setSolAmt] = useState("");
  const closeRef = useRef<HTMLButtonElement>(null);

  const load = useCallback(async () => {
    try { setD(await api<Detail>(`/api/agents/${id}`)); } catch (e) { notify((e as Error).message, true); onClose(); }
  }, [id, notify, onClose]);

  useEffect(() => {
    load();
    history.replaceState(null, "", `#agent-${id}`);
    const t = setInterval(load, 5000);
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => { clearInterval(t); document.removeEventListener("keydown", onKey); };
  }, [id, load, onClose]);

  useEffect(() => {
    if (d && solAmt === "" && me) setSolAmt(d.agent.sol_balance < me.limits.gasSol ? String(+(me.limits.gasSol - d.agent.sol_balance).toFixed(3)) : "0");
  }, [d, me, solAmt]);

  if (!d) return <div className="overlay"><div className="modal"><div className="frame"><span className="tag">Agent desk</span><p className="muted">Loading…</p></div></div></div>;
  const a = d.agent;
  const isOwner = !!me?.wallet && me.wallet === a.owner;
  const color = COLORS[a.color % COLORS.length];
  const p = pnlOf(a);
  const [pc, label] = STATUS_PILL[a.status] ?? ["out", a.status];
  const hs = Object.entries(a.holdings ?? {}).sort((x, y) => y[1].value - x[1].value);
  const r = risk ?? a.risk;
  const remaining = me ? Math.max(0, me.limits.maxDepositUsd - (a.deposited_usd - a.withdrawn_usd)) : 0;

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try { await fn(); notify(ok); await load(); onChanged(); }
    catch (e) { notify((e as Error).message, true); }
    finally { setBusy(false); }
  };

  const deposit = () => act(async () => {
    const u = Number(usdcAmt) || 0, s = Number(solAmt) || 0;
    if (u > remaining + 1e-9) throw new Error(`Beta cap: this agent can take ${usd(remaining)} more USDC.`);
    if (u > 0 && a.status === "awaiting_deposit" && u < (me?.limits.minDepositUsd ?? 0)) throw new Error(`Minimum first deposit is ${usd(me!.limits.minDepositUsd)}.`);
    const sig = await sendDeposit(a.address!, u, s);
    notify("Deposit sent, confirming…");
    await api(`/api/agents/${id}/deposit`, { method: "POST", body: JSON.stringify({ signature: sig }) });
    setSolAmt("0");
  }, "Deposit confirmed");

  return (
    <div className="overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="mName">
        <div className="frame" style={{ ["--agent" as any]: color }}>
          <span className="tag">Agent desk</span>
          <div className="m-head">
            <Sprite strat={a.strat} mood={moodOf({ ...a, spark: d.equity, last: d.events[0] ?? null })} style={{ color }} />
            <div>
              <h3 id="mName" style={{ color }}>{a.name} <span className={"pill " + pc} style={{ fontSize: 12, verticalAlign: "middle" }}>{label}</span></h3>
              <div className="muted">
                {STRATS[a.strat]?.label} · {STRATS[a.strat]?.desc} Universe: {a.uni.map((k) => KIND_LABEL[k]).join(", ")}.
                {a.address && <> Vault <a className="sig" href={acctUrl(a.address)} target="_blank" rel="noreferrer">{short(a.address)}</a>.</>} Owner {short(a.owner)}.
              </div>
            </div>
            <button className="m-close" ref={closeRef} type="button" onClick={onClose}>Close [esc]</button>
          </div>

          <div className="m-grid">
            <Stat k="Equity" v={usd(a.equity_usd)} />
            <Stat k="P&L" v={pct(p.rel)} cls={cls(p.abs)} />
            <Stat k={`Cash · ${a.sol_balance.toFixed(3)} SOL gas`} v={usd(a.cash_usd, 0)} />
            <Stat k="Trades · volume" v={`${a.trades} · ${usdShort(a.volume_usd)}`} />
          </div>

          {a.status === "provisioning" && <p className="note-sm" style={{ marginTop: 16 }}>Creating this agent's vault in Turnkey. This takes a few seconds.{a.error ? ` Last error: ${a.error}` : ""}</p>}

          {isOwner && a.address && ["awaiting_deposit", "live", "paused"].includes(a.status) && (
            <div className="deposit">
              <p className="sub-title" style={{ margin: 0 }}>{a.status === "awaiting_deposit" ? "Fund this agent to go live" : "Top up"}</p>
              <div className="addr"><code>{a.address}</code><button className="chip" type="button" onClick={() => navigator.clipboard.writeText(a.address!).then(() => notify("Address copied")).catch(() => notify("Copy failed, select the address instead", true))}>Copy</button></div>
              <div className="two">
                <div className="field"><label htmlFor="dUsdc">USDC (up to {usd(remaining, 0)})</label><input className="input num" id="dUsdc" type="number" min={0} step="10" value={usdcAmt} onChange={(e) => setUsdcAmt(e.target.value)} /></div>
                <div className="field"><label htmlFor="dSol">SOL for fees</label><input className="input num" id="dSol" type="number" min={0} step="0.005" value={solAmt} onChange={(e) => setSolAmt(e.target.value)} /></div>
              </div>
              <button className="btn" type="button" disabled={busy || !!me?.restricted} onClick={deposit}>{busy ? "Working…" : "Deposit with Phantom"}</button>
              <p className="note-sm">Funds go straight to this agent's own vault. Only you can withdraw them, back to {short(a.owner)}.</p>
            </div>
          )}

          <div className="m-chart" style={{ marginTop: 16 }} dangerouslySetInnerHTML={{ __html: sparkSvg(d.equity, p.abs >= 0 ? "var(--up)" : "var(--down)", 800, 140) }} />

          <div className="m-cols">
            <div>
              <p className="sub-title">Holdings</p>
              <div className="mkts-wrap">
                <table>
                  <thead><tr><th>Asset</th><th className="r">Qty</th><th className="r">Value</th><th className="r">Weight</th><th className="r">vs entry</th></tr></thead>
                  <tbody className="num">
                    {hs.map(([m, h]) => {
                      const vs = h.entry ? h.price / h.entry - 1 : null;
                      return <tr key={m}><td><b className="amber">{h.sym}</b></td><td className="r">{qty(h.ui)}</td><td className="r">{usd(h.value)}</td><td className="r">{a.equity_usd > 0 ? ((h.value / a.equity_usd) * 100).toFixed(1) : "0"}%</td><td className={"r " + (vs === null ? "muted" : cls(vs))}>{vs === null ? "—" : pct(vs, 1)}</td></tr>;
                    })}
                    <tr><td><b>USDC</b></td><td className="r">{qty(a.cash_usd)}</td><td className="r">{usd(a.cash_usd)}</td><td className="r">{a.equity_usd > 0 ? ((a.cash_usd / a.equity_usd) * 100).toFixed(1) : "100"}%</td><td className="r muted">—</td></tr>
                  </tbody>
                </table>
              </div>
            </div>
            <div>
              <p className="sub-title">Agent log</p>
              <div className="m-log num">
                {d.events.map((l) => (
                  <div key={l.id}>
                    <span className="muted">{hhmm(l.ts)}</span>
                    <span className={l.type === "buy" ? "up" : l.type === "sell" || l.type === "err" ? "down" : ""} style={l.type === "think" ? { color: "var(--muted)" } : l.type === "evt" || l.type === "boot" ? { color: "var(--cyan)" } : undefined}>
                      {l.type === "think" ? "· " : ""}{l.text}{l.sig && <> · <a className="sig" href={txUrl(l.sig)} target="_blank" rel="noreferrer">tx</a></>}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {isOwner && a.status !== "retired" && (
            <div className="m-controls">
              {(a.status === "live" || a.status === "paused") && (
                <button className="btn ghost" type="button" disabled={busy} onClick={() => act(() => api(`/api/agents/${id}`, { method: "PATCH", body: JSON.stringify({ action: a.status === "live" ? "pause" : "resume" }) }), a.status === "live" ? "Paused" : "Resumed")}>
                  {a.status === "live" ? "Pause" : "Resume"}
                </button>
              )}
              <div className="range-row">
                <label htmlFor="mRisk" className="muted">Risk</label>
                <input type="range" id="mRisk" min={1} max={10} value={r} onChange={(e) => setRisk(Number(e.target.value))}
                  onPointerUp={() => risk !== null && risk !== a.risk && act(() => api(`/api/agents/${id}`, { method: "PATCH", body: JSON.stringify({ risk }) }), `Risk set to ${risk}`)}
                  onKeyUp={() => risk !== null && risk !== a.risk && act(() => api(`/api/agents/${id}`, { method: "PATCH", body: JSON.stringify({ risk }) }), `Risk set to ${risk}`)} />
                <output htmlFor="mRisk">{r} · {Math.round((0.3 + 0.07 * r) * 100)}%</output>
              </div>
              {a.status !== "withdrawing" && (
                <button className={"btn danger" + (armed ? " armed" : "")} type="button" disabled={busy}
                  onClick={() => { if (!armed) { setArmed(true); return; } setArmed(false); act(() => api(`/api/agents/${id}/withdraw`, { method: "POST" }), "Withdrawal started. Funds return to your wallet in a minute or two."); }}>
                  {armed ? `Confirm: sell all, return ~${usd(a.equity_usd, 0)}` : "Withdraw & retire"}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
