import { esc, price } from "./format";

/** Renders minute prices as an ASCII candle chart (HTML with colored spans). */
export function asciiCandles(points: number[], marker: string | null, cols = 46, rows = 13, per = 3): string {
  const h = points.slice(-cols * per);
  const candles: { o: number; c: number; hi: number; lo: number }[] = [];
  for (let i = 0; i + per <= h.length; i += per) {
    const s = h.slice(i, i + per);
    const o = i > 0 ? h[i - 1] : s[0];
    candles.push({ o, c: s[s.length - 1], hi: Math.max(o, ...s), lo: Math.min(o, ...s) });
  }
  if (!candles.length) return "";
  const mx = Math.max(...candles.map((c) => c.hi));
  const mn = Math.min(...candles.map((c) => c.lo));
  const rng = mx - mn || mx * 0.001 || 1;
  const row = (v: number) => Math.round(((mx - v) / rng) * (rows - 1));
  const lastRow = row(h[h.length - 1]);
  const lines: string[] = [];
  for (let r = 0; r < rows; r++) {
    let out = "", cur: string | null = null, buf = "";
    const flush = () => { if (buf) out += cur ? `<span class="${cur}">${esc(buf)}</span>` : esc(buf); buf = ""; };
    for (const c of candles) {
      const top = row(Math.max(c.o, c.c)), bot = row(Math.min(c.o, c.c)), wt = row(c.hi), wb = row(c.lo);
      let ch = " ", k: string | null = null;
      if (r >= top && r <= bot) { ch = top === bot ? "▬" : "█"; k = c.c >= c.o ? "cu" : "cd"; }
      else if (r >= wt && r <= wb) { ch = "│"; k = c.c >= c.o ? "cu" : "cd"; }
      if (k !== cur) { flush(); cur = k; }
      buf += ch;
    }
    flush();
    const label = r === 0 ? price(mx) : r === rows - 1 ? price(mn) : r === Math.floor(rows / 2) ? price((mx + mn) / 2) : "";
    const tail = r === lastRow ? ` <span class="ag">◄${marker ? "[" + esc(marker.slice(0, 9)) + "]" : ""}</span>` : "";
    lines.push(out + ` <span class="ax">┤${label.padStart(10)}</span>` + tail);
  }
  lines.push(`<span class="ax">${"─".repeat(candles.length)}─┘</span>`);
  return lines.join("\n");
}

export function sparkSvg(arr: number[], color: string, w = 200, h = 34) {
  const d = arr.slice(-120);
  if (d.length < 2) return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true"><line x1="0" y1="${h - 3}" x2="${w}" y2="${h - 3}" stroke="${color}" stroke-opacity=".4" stroke-dasharray="3 3"/></svg>`;
  const mn = Math.min(...d), mx = Math.max(...d), rng = mx - mn || 1;
  const pts = d.map((v, i) => [(i / (d.length - 1)) * w, h - 3 - ((v - mn) / rng) * (h - 6)]);
  const line = pts.map((p) => p[0].toFixed(1) + "," + p[1].toFixed(1)).join(" ");
  const last = pts[pts.length - 1];
  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true"><polygon points="0,${h} ${line} ${w},${h}" fill="${color}" fill-opacity=".1"/><polyline points="${line}" fill="none" stroke="${color}" stroke-width="1.4" vector-effect="non-scaling-stroke"/><circle cx="${last[0]}" cy="${last[1]}" r="2.2" fill="${color}"/></svg>`;
}

const BARS = "▁▂▃▄▅▆▇█";
export function asciiSpark(d: number[]) {
  if (d.length < 2) return "·";
  const mn = Math.min(...d), mx = Math.max(...d), r = mx - mn || 1;
  return d.map((v) => BARS[Math.round(((v - mn) / r) * 7)]).join("");
}

const G: Record<string, string[]> = {
  S: ["███████╗", "██╔════╝", "███████╗", "╚════██║", "███████║", "╚══════╝"],
  T: ["████████╗", "╚══██╔══╝", "   ██║   ", "   ██║   ", "   ██║   ", "   ╚═╝   "],
  O: [" ██████╗ ", "██╔═══██╗", "██║   ██║", "██║   ██║", "╚██████╔╝", " ╚═════╝ "],
  N: ["███╗   ██╗", "████╗  ██║", "██╔██╗ ██║", "██║╚██╗██║", "██║ ╚████║", "╚═╝  ╚═══╝"],
  K: ["██╗  ██╗", "██║ ██╔╝", "█████╔╝ ", "██╔═██╗ ", "██║  ██╗", "╚═╝  ╚═╝"],
  Q: [" ██████╗ ", "██╔═══██╗", "██║   ██║", "██║▄▄ ██║", "╚██████╔╝", " ╚══▀▀═╝ "],
  U: ["██╗   ██╗", "██║   ██║", "██║   ██║", "██║   ██║", "╚██████╔╝", " ╚═════╝ "],
  A: [" █████╗ ", "██╔══██╗", "███████║", "██╔══██║", "██║  ██║", "╚═╝  ╚═╝"],
};
export const figlet = (w: string) => G[w[0]].map((_, i) => w.split("").map((c) => G[c][i]).join("")).join("\n");
