import { Turnkey } from "@turnkey/sdk-server";
import { TurnkeySigner } from "@turnkey/solana";
import type { VersionedTransaction, Transaction } from "@solana/web3.js";
import { env } from "./env";

const provisioner = new Turnkey({
  apiBaseUrl: env.turnkey.baseUrl,
  apiPublicKey: env.turnkey.provisionerPublicKey,
  apiPrivateKey: env.turnkey.provisionerPrivateKey,
  defaultOrganizationId: env.turnkey.orgId,
});

const signerClient = new Turnkey({
  apiBaseUrl: env.turnkey.baseUrl,
  apiPublicKey: env.turnkey.signerPublicKey,
  apiPrivateKey: env.turnkey.signerPrivateKey,
  defaultOrganizationId: env.turnkey.orgId,
});

const signer = new TurnkeySigner({
  organizationId: env.turnkey.orgId,
  client: signerClient.apiClient(),
});

export const PROGRAMS = {
  system: "11111111111111111111111111111111",
  computeBudget: "ComputeBudget111111111111111111111111111111",
  token: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  token2022: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
  ata: "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
  jupiter: "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4",
};

const SOLANA_ACCOUNT = {
  curve: "CURVE_ED25519" as const,
  pathFormat: "PATH_FORMAT_BIP32" as const,
  path: "m/44'/501'/0'/0'",
  addressFormat: "ADDRESS_FORMAT_SOLANA" as const,
};

/** One Turnkey wallet per agent. Keys never leave Turnkey. */
export async function createAgentWallet(agentId: number): Promise<{ walletId: string; address: string }> {
  const res = await provisioner.apiClient().createWallet({
    walletName: `stonk-quant-agent-${agentId}-${Date.now()}`,
    accounts: [SOLANA_ACCOUNT],
  });
  const address = res.addresses[0];
  if (!res.walletId || !address) throw new Error("Turnkey did not return a wallet address");
  return { walletId: res.walletId, address };
}

export async function signerUserId(): Promise<string> {
  if (env.turnkey.signerUserId) return env.turnkey.signerUserId;
  const who = await signerClient.apiClient().getWhoami({ organizationId: env.turnkey.orgId });
  return who.userId;
}

const anyOf = (v: string, list: string[]) => list.map((x) => `${v} == '${x}'`).join(" || ");

/** Condition for the standing swap policy, created once by scripts/setup-turnkey.ts. */
export function swapPolicyCondition(extraPrograms: string[] = []) {
  const allowed = [PROGRAMS.computeBudget, PROGRAMS.jupiter, PROGRAMS.ata, PROGRAMS.token, PROGRAMS.token2022, PROGRAMS.system, ...extraPrograms];
  // Only Jupiter swaps: no direct SOL or SPL transfers anywhere in the transaction.
  return `solana.tx.program_keys.all(p, ${anyOf("p", allowed)}) && solana.tx.transfers.count() == 0 && solana.tx.spl_transfers.count() == 0`;
}

/**
 * One-off policy created when an owner withdraws: lets this agent's wallet send SOL only to
 * the owner, and tokens only into the owner's own token accounts.
 */
export async function createWithdrawPolicy(agentId: number, walletId: string, owner: string, ownerTokenAccounts: string[]) {
  const uid = await signerUserId();
  const spl = ownerTokenAccounts.length ? `solana.tx.spl_transfers.all(t, ${anyOf("t.to", ownerTokenAccounts)})` : "solana.tx.spl_transfers.count() == 0";
  const condition = [
    `wallet.id == '${walletId}'`,
    `solana.tx.program_keys.all(p, ${anyOf("p", [PROGRAMS.system, PROGRAMS.computeBudget, PROGRAMS.token, PROGRAMS.token2022, PROGRAMS.ata])})`,
    `solana.tx.transfers.all(t, t.to == '${owner}')`,
    spl,
  ].join(" && ");
  const res = await provisioner.apiClient().createPolicy({
    policyName: `stonk-quant withdraw agent ${agentId} ${Date.now()}`,
    effect: "EFFECT_ALLOW",
    consensus: `approvers.any(user, user.id == '${uid}')`,
    condition,
    notes: `Withdraw agent ${agentId} to ${owner}`,
  });
  return res.policyId;
}

export async function createSwapPolicy(extraPrograms: string[] = []) {
  const uid = await signerUserId();
  const res = await provisioner.apiClient().createPolicy({
    policyName: "stonk-quant agent swaps via Jupiter",
    effect: "EFFECT_ALLOW",
    consensus: `approvers.any(user, user.id == '${uid}')`,
    condition: swapPolicyCondition(extraPrograms),
    notes: "Agents may only sign Jupiter swap transactions with no direct transfers.",
  });
  return { policyId: res.policyId, signerUserId: uid };
}

export async function signTx<T extends VersionedTransaction | Transaction>(tx: T, address: string): Promise<T> {
  await signer.addSignature(tx, address);
  return tx;
}
