"use client";
import { Buffer } from "buffer";
import { PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import { createAssociatedTokenAccountIdempotentInstruction, createTransferCheckedInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import bs58 from "bs58";
import { USDC_MINT } from "@stonkquant/core";

if (typeof window !== "undefined" && !(window as any).Buffer) (window as any).Buffer = Buffer;

interface PhantomProvider {
  isPhantom?: boolean;
  publicKey?: { toString(): string } | null;
  connect(opts?: { onlyIfTrusted?: boolean }): Promise<{ publicKey: { toString(): string } }>;
  disconnect(): Promise<void>;
  signMessage(msg: Uint8Array, display?: "utf8" | "hex"): Promise<{ signature: Uint8Array }>;
  signAndSendTransaction(tx: Transaction): Promise<{ signature: string }>;
}

export function phantom(): PhantomProvider | null {
  if (typeof window === "undefined") return null;
  const w = window as any;
  const p = w.phantom?.solana ?? (w.solana?.isPhantom ? w.solana : null);
  return p && p.isPhantom ? (p as PhantomProvider) : null;
}

async function j<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as any).error || `request failed (${res.status})`);
  return data as T;
}

export async function signIn(): Promise<string> {
  const p = phantom();
  if (!p) {
    window.open("https://phantom.app/ul/browse/" + encodeURIComponent(window.location.href), "_blank");
    throw new Error("Phantom wasn't found. Install it, or open this page in the Phantom app.");
  }
  const { publicKey } = await p.connect();
  const wallet = publicKey.toString();
  const { nonce, message } = await j<{ nonce: string; message: string }>(await fetch(`/api/auth/nonce?wallet=${wallet}`));
  const { signature } = await p.signMessage(new TextEncoder().encode(message), "utf8");
  await j(await fetch("/api/auth/verify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ wallet, nonce, signature: bs58.encode(signature) }) }));
  return wallet;
}

export async function signOut() {
  await fetch("/api/auth/logout", { method: "POST" });
  await phantom()?.disconnect().catch(() => {});
}

/** Build and send a deposit from the connected Phantom wallet to an agent vault. */
export async function sendDeposit(agentAddress: string, usdcAmount: number, solAmount: number): Promise<string> {
  const p = phantom();
  if (!p) throw new Error("Phantom wasn't found");
  const { publicKey } = await p.connect();
  const owner = new PublicKey(publicKey.toString());
  const agent = new PublicKey(agentAddress);
  const mint = new PublicKey(USDC_MINT);
  const tx = new Transaction();
  if (usdcAmount > 0) {
    const from = getAssociatedTokenAddressSync(mint, owner);
    const to = getAssociatedTokenAddressSync(mint, agent);
    tx.add(createAssociatedTokenAccountIdempotentInstruction(owner, to, agent, mint));
    tx.add(createTransferCheckedInstruction(from, mint, to, owner, BigInt(Math.round(usdcAmount * 1e6)), 6));
  }
  if (solAmount > 0) tx.add(SystemProgram.transfer({ fromPubkey: owner, toPubkey: agent, lamports: Math.round(solAmount * 1e9) }));
  if (!tx.instructions.length) throw new Error("enter an amount to deposit");
  const { blockhash } = await j<{ blockhash: string }>(await fetch("/api/blockhash"));
  tx.recentBlockhash = blockhash;
  tx.feePayer = owner;
  const { signature } = await p.signAndSendTransaction(tx);
  return signature;
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  return j<T>(await fetch(path, { ...init, headers: { "content-type": "application/json", ...(init?.headers || {}) } }));
}
