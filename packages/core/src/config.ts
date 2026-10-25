declare const process: { env: Record<string, string | undefined> };
// Shared limits. Each one reads an env var so you can tune without a code change.
const num = (v: string | undefined, d: number) => (v !== undefined && v !== "" && !Number.isNaN(Number(v)) ? Number(v) : d);

export const LIMITS = {
  /** Max total USDC a single agent may receive through the app (beta cap). */
  maxDepositUsd: num(process.env.MAX_DEPOSIT_USD, 1000),
  minDepositUsd: num(process.env.MIN_DEPOSIT_USD, 25),
  maxAgentsPerWallet: num(process.env.MAX_AGENTS_PER_WALLET, 5),
  /** SOL each new agent asks for to cover fees and token-account rent. */
  gasSol: num(process.env.AGENT_GAS_SOL, 0.03),
  /** Below this SOL balance the agent pauses itself. */
  minGasSol: num(process.env.AGENT_MIN_GAS_SOL, 0.006),
  minTradeUsd: num(process.env.MIN_TRADE_USD, 5),
  maxOrdersPerRebalance: num(process.env.MAX_ORDERS_PER_REBALANCE, 4),
  maxPriceImpactPct: num(process.env.MAX_PRICE_IMPACT_PCT, 1.5),
  slippageBpsStock: num(process.env.SLIPPAGE_BPS_STOCK, 75),
  slippageBpsPair: num(process.env.SLIPPAGE_BPS_PAIR, 300),
};

export function blockedCountries(): string[] {
  const raw = process.env.BLOCKED_COUNTRIES ?? "US,CA,GB,AU,CN,RU,IR,KP,SY,CU,BY";
  return raw.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
}
