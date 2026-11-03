// Run the v1-vs-v2 backtest on the last 7 days of real prices and print the table.
// Usage: DATABASE_URL=... npm run backtest -w @stonkquant/worker
import { sql } from "../src/db";
import { printSummary, runBacktests } from "../src/backtestJob";

runBacktests()
  .then((s) => { if (s) printSummary(s); else console.log("not enough price history yet (need 10+ hours)"); })
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => sql.end({ timeout: 5 }));
