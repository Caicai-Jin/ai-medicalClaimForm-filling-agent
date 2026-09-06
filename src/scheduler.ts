import { runExclusive } from "./exclusiveRunner";
import { systemLog } from "./logger";

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;

export function startScheduler(
  intervalMs: number = Number(process.env.SCHEDULE_INTERVAL_MS) || DEFAULT_INTERVAL_MS
) {
  systemLog.info("scheduler.started", { intervalMs });

  const tick = async () => {
    systemLog.info("scheduler.tick");
    const outcome = await runExclusive();
    systemLog.info("scheduler.tick_finished", {
      runId: outcome.runId,
      status: outcome.status,
      category: outcome.category,
      error: outcome.error,
    });
  };

  void tick();
  return setInterval(tick, intervalMs);
}
