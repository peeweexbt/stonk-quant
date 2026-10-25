import { json } from "@/lib/auth";
import { connection } from "@/lib/solana";

export const dynamic = "force-dynamic";

// Lets the browser build deposit transactions without exposing the RPC key.
export async function GET() {
  const b = await connection().getLatestBlockhash("confirmed");
  return json(b, 200, { "cache-control": "no-store" });
}
