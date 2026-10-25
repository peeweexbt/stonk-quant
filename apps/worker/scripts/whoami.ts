// Prints which Turnkey user each API key in .env belongs to. Usage: npx tsx apps/worker/scripts/whoami.ts
import { Turnkey } from "@turnkey/sdk-server";
const org = process.env.TURNKEY_ORGANIZATION_ID!;
for (const [label, pub, priv] of [
  ["PROVISIONER (must be Root user)", process.env.TURNKEY_PROVISIONER_API_PUBLIC_KEY, process.env.TURNKEY_PROVISIONER_API_PRIVATE_KEY],
  ["SIGNER (must be stonk-quant-signer)", process.env.TURNKEY_SIGNER_API_PUBLIC_KEY, process.env.TURNKEY_SIGNER_API_PRIVATE_KEY],
] as const) {
  try {
    const tk = new Turnkey({ apiBaseUrl: process.env.TURNKEY_API_BASE_URL || "https://api.turnkey.com", apiPublicKey: pub!, apiPrivateKey: priv!, defaultOrganizationId: org });
    const w = await tk.apiClient().getWhoami({ organizationId: org });
    console.log(`${label}: ${w.username} (${w.userId})`);
  } catch (e) { console.log(`${label}: ERROR ${(e as Error).message}`); }
}
