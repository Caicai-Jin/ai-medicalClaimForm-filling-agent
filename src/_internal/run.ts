import "dotenv-defaults/config";
import { main } from "../main";

// Awaiting (rather than the previous fire-and-forget `main()`) matters: an unhandled rejection
// here crashes the process abruptly, which we found can cut Windows off before it finishes
// reaping the Chromium child processes browser.close() already asked it to tear down.
main().catch((e) => {
  console.error(`\n[fatal] ${e instanceof Error ? e.message : e}`);
  process.exitCode = 1;
});
