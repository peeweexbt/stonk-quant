import { Connection, PublicKey, VersionedTransaction, Transaction, ComputeBudgetProgram } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { env } from "./env";
import { signTx } from "./turnkey";

export const connection = new Connection(env.rpcUrl, "confirmed");

export interface TokenBal {
  mint: string;
  account: string;
  program: string;
  raw: bigint;
  ui: number;
  decimals: number;
}

export interface Balances {
  sol: number;
  lamports: number;
  tokens: Record<string, TokenBal>;
}

export async function getBalances(owner: string): Promise<Balances> {
  const pk = new PublicKey(owner);
  const [lamports, a, b] = await Promise.all([
    connection.getBalance(pk, "confirmed"),
    connection.getParsedTokenAccountsByOwner(pk, { programId: TOKEN_PROGRAM_ID }, "confirmed"),
    connection.getParsedTokenAccountsByOwner(pk, { programId: TOKEN_2022_PROGRAM_ID }, "confirmed"),
  ]);
  const tokens: Record<string, TokenBal> = {};
  for (const [list, program] of [[a, TOKEN_PROGRAM_ID], [b, TOKEN_2022_PROGRAM_ID]] as const) {
    for (const acc of list.value) {
      const info = (acc.account.data as any).parsed?.info;
      if (!info) continue;
      const ta = info.tokenAmount;
      const raw = BigInt(ta.amount);
      const prev = tokens[info.mint];
      // Use the account with the larger balance if a wallet somehow has two for one mint.
      if (prev && prev.raw >= raw) continue;
      tokens[info.mint] = {
        mint: info.mint,
        account: acc.pubkey.toBase58(),
        program: program.toBase58(),
        raw,
        ui: Number(ta.uiAmountString ?? ta.uiAmount ?? 0),
        decimals: ta.decimals,
      };
    }
  }
  return { sol: lamports / 1e9, lamports, tokens };
}

/** Sign with the agent's Turnkey key, send, and wait for confirmation. Returns the signature. */
export async function signAndSend(tx: VersionedTransaction | Transaction, address: string, lastValidBlockHeight?: number): Promise<string> {
  let blockhash: string;
  let lvbh = lastValidBlockHeight;
  if (tx instanceof VersionedTransaction) {
    blockhash = tx.message.recentBlockhash;
  } else {
    const latest = await connection.getLatestBlockhash("confirmed");
    tx.recentBlockhash = latest.blockhash;
    tx.feePayer = new PublicKey(address);
    blockhash = latest.blockhash;
    lvbh = latest.lastValidBlockHeight;
  }
  if (lvbh === undefined) lvbh = (await connection.getLatestBlockhash("confirmed")).lastValidBlockHeight;
  await signTx(tx, address);
  const raw = tx.serialize();
  const sig = await connection.sendRawTransaction(raw, { skipPreflight: false, maxRetries: 2, preflightCommitment: "confirmed" });
  // Rebroadcast until confirmed or the blockhash expires.
  let done = false;
  const rebroadcast = (async () => {
    while (!done) {
      await new Promise((r) => setTimeout(r, 2500));
      if (done) break;
      connection.sendRawTransaction(raw, { skipPreflight: true, maxRetries: 0 }).catch(() => {});
    }
  })();
  try {
    const res = await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight: lvbh }, "confirmed");
    if (res.value.err) throw new Error(`transaction failed on-chain: ${JSON.stringify(res.value.err)}`);
  } finally {
    done = true;
    await rebroadcast;
  }
  return sig;
}

export const priorityIx = () => ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50_000 });
