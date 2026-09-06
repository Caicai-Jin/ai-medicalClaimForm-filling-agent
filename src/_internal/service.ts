import "dotenv-defaults/config";
import { startServer } from "../server";
import { startScheduler } from "../scheduler";

// Runs the API and the scheduler in the same process so they share one in-memory
// concurrency lock (see runner.ts) -- an API-triggered run and a scheduled run can
// never collide on the same Playwright session.
startServer();
startScheduler();
