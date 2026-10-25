export function usd(x: number, dp?: number) {
  const a = Math.abs(x);
  if (dp === undefined) dp = a >= 1000 ? 0 : 2;
  return (x < 0 ? "-$" : "$") + a.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });
}
export function usdShort(x: number) {
  const a = Math.abs(x), s = x < 0 ? "-$" : "$";
  if (a >= 1e6) return s + (a / 1e6).toFixed(2) + "M";
  if (a >= 1e4) return s + (a / 1e3).toFixed(1) + "k";
  return s + a.toFixed(0);
}
export function price(p: number | null | undefined) {
  if (p === null || p === undefined || !Number.isFinite(p)) return "—";
  if (p >= 100) return "$" + p.toFixed(2);
  if (p >= 1) return "$" + p.toFixed(3);
  if (p >= 0.01) return "$" + p.toFixed(4);
  return "$" + p.toPrecision(3);
}
export function qty(q: number) {
  const a = Math.abs(q);
  if (a >= 1e6) return (q / 1e6).toFixed(2) + "M";
  if (a >= 1e3) return (q / 1e3).toFixed(1) + "k";
  if (a >= 1) return q.toFixed(2);
  return q.toPrecision(3);
}
export const pct = (x: number, dp = 2) => (x >= 0 ? "+" : "") + (x * 100).toFixed(dp) + "%";
export const cls = (x: number) => (x >= 0 ? "up" : "down");
export const short = (a: string) => a.slice(0, 4) + "…" + a.slice(-4);
export const hhmm = (ts: string | number | Date) => {
  const d = new Date(ts);
  return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
};
export const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
export const txUrl = (sig: string) => `https://solscan.io/tx/${sig}`;
export const acctUrl = (a: string) => `https://solscan.io/account/${a}`;
export const COLORS = ["var(--amber)", "var(--fire)", "var(--violet)", "var(--lime)", "var(--pink)", "var(--cyan)"];
