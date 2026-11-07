"use client";
import { useState } from "react";

export const CA = "5uhjgW31K5DiwMEvetFD9Lqn261ZJSG73HW4UDcfLoat";

/** Token contract address with one-click copy. `compact` shortens it for tight headers. */
export function CaChip({ compact = false }: { compact?: boolean }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(CA); }
    catch {
      const t = document.createElement("textarea");
      t.value = CA; document.body.appendChild(t); t.select();
      try { document.execCommand("copy"); } finally { t.remove(); }
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <button type="button" className={"ca-chip" + (compact ? " compact" : "")} onClick={copy} title="Copy contract address" aria-label={`Contract address ${CA}, click to copy`}>
      <span className="ca-k">CA</span>
      <span className="ca-v num">{compact ? `${CA.slice(0, 4)}…${CA.slice(-4)}` : CA}</span>
      <span className="ca-c">{copied ? "copied ✓" : "copy"}</span>
    </button>
  );
}
