import { LIMITS } from "@stonkquant/core";
import { json, sessionWallet } from "@/lib/auth";
import { restrictedCountry, RESTRICTED_MSG } from "@/lib/geo";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const wallet = await sessionWallet();
  const restricted = restrictedCountry(req);
  return json(
    {
      wallet,
      restricted: restricted ? { country: restricted, message: RESTRICTED_MSG } : null,
      limits: { gasSol: LIMITS.gasSol, minDepositUsd: LIMITS.minDepositUsd, maxDepositUsd: LIMITS.maxDepositUsd, maxAgents: LIMITS.maxAgentsPerWallet },
      rpcUrl: process.env.NEXT_PUBLIC_SOLANA_RPC_URL || null,
    },
    200,
    { "cache-control": "no-store" },
  );
}
