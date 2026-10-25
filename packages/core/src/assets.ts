// Curated stonk.fun quote assets. Mints come from stonk.fun's own quote-token list.
// Launchpad coins (stonk.fun pairs, pump.fun custom pairs, OTC desk stock-reward coins) are discovered
// at runtime by the worker (see apps/worker/src/discovery.ts).

export type AssetKind = "xstock" | "prestock" | "pair" | "pump" | "otc" | "stonk";

/** Launchpad coins tied to stocks: stonk.fun pairs, pump.fun custom pairs, OTC desk reward coins. */
export const LAUNCH_KINDS: AssetKind[] = ["pair", "pump", "otc"];
export const isLaunchCoin = (k: AssetKind) => k === "pair" || k === "pump" || k === "otc";
export const ALL_KINDS: AssetKind[] = ["xstock", "prestock", "pair", "pump", "otc", "stonk"];

export interface AssetDef {
  mint: string;
  sym: string;
  name: string;
  kind: AssetKind;
  decimals: number;
  quoteMint?: string | null;
  quoteSym?: string | null;
}

export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const USDC_DECIMALS = 6;
export const STONK_MINT = "6GmAFSYs4gk3FDao5FzzySQpPZaWsa4rUJHacpMpUNgx";

export const CURATED_ASSETS: AssetDef[] = [
  // xStocks (Backed Finance, Token-2022, 8 decimals)
  { mint: "XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W", sym: "SPYx", name: "S&P 500 tracker", kind: "xstock", decimals: 8 },
  { mint: "Xs8S1uUs1zvS2p7iwtsG3b6fkhpvmwz4GYU3gWAmWHZ", sym: "QQQx", name: "Nasdaq-100 tracker", kind: "xstock", decimals: 8 },
  { mint: "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh", sym: "NVDAx", name: "NVIDIA", kind: "xstock", decimals: 8 },
  { mint: "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB", sym: "TSLAx", name: "Tesla", kind: "xstock", decimals: 8 },
  { mint: "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp", sym: "AAPLx", name: "Apple", kind: "xstock", decimals: 8 },
  { mint: "Xsa62P5mvPszXL1krVUnU5ar38bBSVcWAB6fmPCo5Zu", sym: "METAx", name: "Meta", kind: "xstock", decimals: 8 },
  { mint: "XsCPL9dNWBMvFtTmwcCA5v3xWPSMEBCszbQdiLLq6aN", sym: "GOOGLx", name: "Alphabet", kind: "xstock", decimals: 8 },
  { mint: "Xs3eBt7uRfJX8QUs4suhyU8p2M6DoUDrJyWBa8LLZsg", sym: "AMZNx", name: "Amazon", kind: "xstock", decimals: 8 },
  { mint: "XspzcW1PRtgf6Wj92HCiZdjzKCyFekVD8P5Ueh3dRMX", sym: "MSFTx", name: "Microsoft", kind: "xstock", decimals: 8 },
  { mint: "Xs7ZdzSHLU9ftNJsii5fCeJhoRWSC32SQGzGQtePxNu", sym: "COINx", name: "Coinbase", kind: "xstock", decimals: 8 },
  { mint: "XsP7xzNPvEHS1m6qfanPUGjNmdnmsLKEoNAnHjdxxyZ", sym: "MSTRx", name: "Strategy", kind: "xstock", decimals: 8 },
  { mint: "XsvNBAYkrDRNhA7wPHQfX3ZUXZyZLdnCQDfHZ56bzpg", sym: "HOODx", name: "Robinhood", kind: "xstock", decimals: 8 },
  { mint: "XsoBhf2ufR8fTyNSjqfU71DYGaE6Z3SUGAidpzriAA4", sym: "PLTRx", name: "Palantir", kind: "xstock", decimals: 8 },
  { mint: "XsueG8BtpquVJX9LVLLEGuViXUungE6WmK5YZ3p3bd1", sym: "CRCLx", name: "Circle", kind: "xstock", decimals: 8 },
  { mint: "Xsf9mBktVB9BSU5kf4nHxPq5hCBJ2j2ui3ecFGxPRGc", sym: "GMEx", name: "GameStop", kind: "xstock", decimals: 8 },
  { mint: "Xsv9hRk1z5ystj9MhnA7Lq4vjSsLwzL2nxrwmwtD3re", sym: "GLDx", name: "Gold tracker", kind: "xstock", decimals: 8 },
  { mint: "Xs3oZwbHvqis4NYcf4YKWmEia2eC84wSiVrcYcTqpH8", sym: "SPCXx", name: "SpaceX", kind: "xstock", decimals: 8 },
  // PreStocks (pre-IPO tokens, 9 decimals)
  { mint: "PreweJYECqtQwBtpxHL171nL2K6umo692gTm7Q3rpgF", sym: "OPENAI", name: "OpenAI pre-IPO", kind: "prestock", decimals: 9 },
  { mint: "Pren1FvFX6J3E4kXhJuCiAD5aDmGEb7qJRncwA8Lkhw", sym: "ANTHROPIC", name: "Anthropic pre-IPO", kind: "prestock", decimals: 9 },
  { mint: "PresTj4Yc2bAR197Er7wz4UUKSfqt6FryBEdAriBoQB", sym: "ANDURIL", name: "Anduril pre-IPO", kind: "prestock", decimals: 9 },
  { mint: "Pre8AREmFPtoJFT8mQSXQLh56cwJmM7CFDRuoGBZiUP", sym: "POLYMARKET", name: "Polymarket pre-IPO", kind: "prestock", decimals: 9 },
  { mint: "PreLWGkkeqG1s4HEfFZSy9moCrJ7btsHuUtfcCeoRua", sym: "KALSHI", name: "Kalshi pre-IPO", kind: "prestock", decimals: 9 },
  { mint: "PrekqLJvJ3qVdXmBGDiexvwUTF4rLFDa6HWS4HJbw9S", sym: "NEURALINK", name: "Neuralink pre-IPO", kind: "prestock", decimals: 9 },
  // Platform token
  { mint: STONK_MINT, sym: "STONK", name: "stonk.fun platform token", kind: "stonk", decimals: 9 },
];

export const KIND_LABEL: Record<AssetKind, string> = {
  xstock: "xStock",
  prestock: "PreStock",
  pair: "stonk.fun pair",
  pump: "pump.fun pair",
  otc: "OTC desk coin",
  stonk: "platform",
};

// Cap-weighted-ish basket for the Index Hugger, by symbol.
export const INDEX_WEIGHTS: Record<string, number> = {
  SPYx: 0.3,
  QQQx: 0.2,
  NVDAx: 0.1,
  AAPLx: 0.08,
  MSFTx: 0.08,
  GOOGLx: 0.06,
  AMZNx: 0.06,
  METAx: 0.06,
  TSLAx: 0.06,
};
