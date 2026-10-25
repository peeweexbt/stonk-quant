import { VersionedTransaction } from "@solana/web3.js";
import { env } from "./env";

const headers = (): Record<string, string> => {
  const h: Record<string, string> = { "content-type": "application/json", accept: "application/json" };
  if (env.jupiter.apiKey) h["x-api-key"] = env.jupiter.apiKey;
  return h;
};

async function jfetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(env.jupiter.baseUrl + path, { ...init, headers: { ...headers(), ...(init?.headers as any) } });
  const text = await res.text();
  if (!res.ok) throw new Error(`Jupiter ${path.split("?")[0]} ${res.status}: ${text.slice(0, 200)}`);
  return JSON.parse(text) as T;
}

/** USD prices for up to N mints, batched 50 at a time. */
export async function getPrices(mints: string[]): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (let i = 0; i < mints.length; i += 50) {
    const ids = mints.slice(i, i + 50).join(",");
    try {
      const data = await jfetch<Record<string, { usdPrice?: number } | null>>(`/price/v3?ids=${ids}`);
      for (const [m, v] of Object.entries(data)) if (v && typeof v.usdPrice === "number" && v.usdPrice > 0) out[m] = v.usdPrice;
    } catch (e) {
      console.warn("[prices]", (e as Error).message);
    }
  }
  return out;
}

export interface Quote {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  otherAmountThreshold: string;
  priceImpactPct: string;
  routePlan: { swapInfo: { label?: string } }[];
  [k: string]: unknown;
}

export async function getQuote(inputMint: string, outputMint: string, amountRaw: bigint, slippageBps: number): Promise<Quote> {
  const q = new URLSearchParams({
    inputMint,
    outputMint,
    amount: amountRaw.toString(),
    slippageBps: String(slippageBps),
    restrictIntermediateTokens: "true",
    maxAccounts: "48",
  });
  return jfetch<Quote>(`/swap/v1/quote?${q}`);
}

export async function buildSwap(quote: Quote, userPublicKey: string): Promise<{ tx: VersionedTransaction; lastValidBlockHeight: number }> {
  const res = await jfetch<{ swapTransaction: string; lastValidBlockHeight: number }>(`/swap/v1/swap`, {
    method: "POST",
    body: JSON.stringify({
      quoteResponse: quote,
      userPublicKey,
      // Agents hold USDC as their hub asset, so no SOL wrapping (keeps the signing policy tight).
      wrapAndUnwrapSol: false,
      dynamicComputeUnitLimit: true,
      prioritizationFeeLamports: { priorityLevelWithMaxLamports: { maxLamports: env.jupiter.maxPriorityLamports, priorityLevel: "high" } },
    }),
  });
  const tx = VersionedTransaction.deserialize(Buffer.from(res.swapTransaction, "base64"));
  return { tx, lastValidBlockHeight: res.lastValidBlockHeight };
}
