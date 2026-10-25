"use client";
import { useEffect, useState } from "react";
import type { StratKey } from "@stonkquant/core";
import { spriteText, type Mood } from "./sprite-text";

export { spriteText, type Mood };

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
