import { Connection, PublicKey } from "@solana/web3.js";
import { USDC_MINT } from "@stonkquant/core";

let conn: Connection | null = null;
export function connection() {
  if (!conn) {
    const url = process.env.SOLANA_RPC_URL;
    if (!url) throw new Error("SOLANA_RPC_URL is not set");
    conn = new Connection(url, "confirmed");
  }
  return conn;
}

export function isPubkey(s: unknown): s is string {
  if (typeof s !== "string" || s.length < 32 || s.length > 44) return false;
  try { new PublicKey(s); return true; } catch { return false; }
}

/** Read a confirmed deposit and work out how much USDC and SOL landed in the agent vault. */
export async function readDeposit(sig: string, agentAddress: string, fromWallet: string) {
  let tx = null;
  for (let i = 0; i < 15 && !tx; i++) {
    tx = await connection().getParsedTransaction(sig, { maxSupportedTransactionVersion: 0, commitment: "confirmed" });
    if (!tx) await new Promise((r) => setTimeout(r, 1500));
  }
  if (!tx) throw new Error("transaction not found yet; try again in a few seconds");
  if (tx.meta?.err) throw new Error("transaction failed on-chain");
  const keys = tx.transaction.message.accountKeys;
  const signers = keys.filter((k) => k.signer).map((k) => k.pubkey.toBase58());
  if (!signers.includes(fromWallet)) throw new Error("deposit wasn't signed by your wallet");

  const pre = tx.meta?.preTokenBalances ?? [];
  const post = tx.meta?.postTokenBalances ?? [];
  let usdc = 0;
  for (const p of post) {
    if (p.owner !== agentAddress || p.mint !== USDC_MINT) continue;
    const before = pre.find((x) => x.accountIndex === p.accountIndex);
    usdc += Number(p.uiTokenAmount.uiAmountString ?? 0) - Number(before?.uiTokenAmount.uiAmountString ?? 0);
  }
  const idx = keys.findIndex((k) => k.pubkey.toBase58() === agentAddress);
  const sol = idx >= 0 && tx.meta ? (tx.meta.postBalances[idx] - tx.meta.preBalances[idx]) / 1e9 : 0;
  return { usdc: Math.max(0, usdc), sol: Math.max(0, sol) };
}
