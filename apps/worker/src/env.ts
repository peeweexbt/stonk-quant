function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var ${name}. See .env.example.`);
  return v;
}
const opt = (name: string, d: string) => process.env[name] || d;

export const env = {
  databaseUrl: req("DATABASE_URL"),
  rpcUrl: req("SOLANA_RPC_URL"),
  turnkey: {
    baseUrl: opt("TURNKEY_API_BASE_URL", "https://api.turnkey.com"),
    orgId: req("TURNKEY_ORGANIZATION_ID"),
    // Provisioner: creates wallets and withdrawal policies. Root/admin user.
    provisionerPublicKey: req("TURNKEY_PROVISIONER_API_PUBLIC_KEY"),
    provisionerPrivateKey: req("TURNKEY_PROVISIONER_API_PRIVATE_KEY"),
    // Signer: non-root user that every agent transaction is signed with, so policies apply.
    signerPublicKey: req("TURNKEY_SIGNER_API_PUBLIC_KEY"),
    signerPrivateKey: req("TURNKEY_SIGNER_API_PRIVATE_KEY"),
    signerUserId: opt("TURNKEY_SIGNER_USER_ID", ""),
  },
  jupiter: {
    apiKey: opt("JUPITER_API_KEY", ""),
    baseUrl: process.env.JUPITER_API_KEY ? opt("JUPITER_BASE_URL", "https://api.jup.ag") : opt("JUPITER_BASE_URL", "https://lite-api.jup.ag"),
    maxPriorityLamports: Number(opt("JUPITER_MAX_PRIORITY_LAMPORTS", "300000")),
  },
  stonkfunBase: opt("STONKFUN_BASE_URL", "https://www.stonkfun.xyz"),
  tradingEnabled: opt("TRADING_ENABLED", "true") === "true",
  withdrawalsEnabled: opt("WITHDRAWALS_ENABLED", "true") === "true",
  discovery: {
    minMcapUsd: Number(opt("DISCOVERY_MIN_MCAP_USD", "100000")),
    minVol24hUsd: Number(opt("DISCOVERY_MIN_VOL24H_USD", "5000")),
    max: Number(opt("DISCOVERY_MAX_PAIRS", "24")),
    intervalSec: Number(opt("DISCOVERY_INTERVAL_SEC", "60")),
    pump: opt("DISCOVERY_PUMP", "true") === "true",
    // pump.fun custom pairs and OTC coins are much smaller than stonk.fun pairs, so they get their own floors
    pumpMinMcapUsd: Number(opt("DISCOVERY_PUMP_MIN_MCAP_USD", "30000")),
    pumpMinVol24hUsd: Number(opt("DISCOVERY_PUMP_MIN_VOL24H_USD", "300")),
    otcMinMcapUsd: Number(opt("DISCOVERY_OTC_MIN_MCAP_USD", "30000")),
    otcMinVol24hUsd: Number(opt("DISCOVERY_OTC_MIN_VOL24H_USD", "5000")),
    maxPump: Number(opt("DISCOVERY_MAX_PUMP", "16")),
    otc: opt("DISCOVERY_OTC", "true") === "true",
    maxOtc: Number(opt("DISCOVERY_MAX_OTC", "16")),
  },
  otcBase: opt("OTC_BASE_URL", "https://otcdesks.cash"),
};
