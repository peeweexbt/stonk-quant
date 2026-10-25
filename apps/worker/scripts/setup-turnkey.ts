// One-time: create the standing swap policy for the non-root signer user.
// Usage: npm run setup:turnkey  [-- extraProgramId1,extraProgramId2]
import { createSwapPolicy, swapPolicyCondition } from "../src/turnkey";

const extra = (process.argv[2] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
console.log("Creating swap policy with condition:\n", swapPolicyCondition(extra), "\n");
createSwapPolicy(extra)
  .then(({ policyId, signerUserId }) => {
    console.log(`Policy created: ${policyId}`);
    console.log(`Signer user: ${signerUserId}  (set TURNKEY_SIGNER_USER_ID to skip the lookup)`);
    process.exit(0);
  })
  .catch((e) => { console.error(e); process.exit(1); });
