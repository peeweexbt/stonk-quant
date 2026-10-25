"use client";
import { useEffect, useState } from "react";
import { STRATS, type StratKey } from "@stonkquant/core";

export type Mood = "idle" | "happy" | "sad" | "trade" | "sleep" | "boot";

const BLANK = "           ";

export function spriteText(strat: StratKey, mood: Mood, f: number, reduce = false) {
  const S = STRATS[strat] ?? STRATS.MOMENTUM;
  const hat = S.hat[Math.floor(f / 2) % S.hat.length];
  let e = "o", m = "_";
  if (mood === "happy") { e = "^"; m = "v"; }
  else if (mood === "sad") { e = "T"; m = "~"; }
  else if (mood === "trade") { e = "$"; m = "o"; }
  else if (mood === "sleep") { e = "-"; m = "_"; }
  if (mood !== "sleep" && mood !== "trade" && f % 11 === 0) e = "-";
  const wave = f % 2 === 0;
  const arms = mood === "happy" || mood === "trade" ? (wave ? " \\─┤ $ ├─/ " : " ──┤ $ ├── ") : mood === "sad" ? " /─┤ $ ├─\\ " : wave ? " ──┤ $ ├── " : " ─╴┤ $ ├╶─ ";
  const legs = mood === "sleep" ? "    │ │    " : f % 4 < 2 ? "    ╱ ╲    " : "    │ │    ";
  const lines = [mood === "sleep" ? hat.replace(/ {2}$/, "zZ") : hat, "  ┌─────┐  ", `  │ ${e} ${e} │  `, `  │  ${m}  │  `, "  └──┬──┘  ", arms, legs];
  if (mood === "boot") {
    const k = f % (lines.length + 3);
    return [BLANK, ...lines.map((l, i) => (i < k ? l : i === k ? " ░▒▓█▓▒░   " : BLANK))].join("\n");
  }
  const bob = !reduce && mood !== "sleep" && f % 4 < 2;
  return (bob ? [BLANK, ...lines] : [...lines, BLANK]).join("\n");
}

export function Sprite({ strat, mood, className = "sprite", style }: { strat: StratKey; mood: Mood; className?: string; style?: React.CSSProperties }) {
  const [f, setF] = useState(1);
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduce(mq.matches);
    const t = setInterval(() => setF((x) => x + 1), mood === "boot" ? 260 : 340);
    return () => clearInterval(t);
  }, [mood]);
  return <pre className={className} style={style} aria-hidden="true">{spriteText(strat, mood, reduce ? 1 : f, reduce)}</pre>;
}
