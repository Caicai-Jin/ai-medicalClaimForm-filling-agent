import { TaskRunner, WorkflowResult } from "./taskRunner";
import { MedicalFormData, exampleFormData } from "./types";
import { CategorizedError, FailureCategory } from "./errors";
import { createRunLogger, generateRunId } from "./logger";

export interface RunOutcome {
  runId: string;
  status: "completed" | "skipped" | "failed";
  summary?: string;
  error?: string;
  category?: FailureCategory;
  screenshotPath?: string;
}

export interface RetryOptions {
  maxAttempts?: number;
  retryDelayMs?: number;
}

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_RETRY_DELAY_MS = 2000;

// Only transient, environment-level failures are worth retrying. A "verification" failure means
// the agent ran to completion without an error and the page just never confirmed success --
// retrying won't change that. An "llm" failure is often an auth/config problem (e.g. a bad API
// key) that a retry won't fix either. "network" and "timeout" are the categories where a second
// attempt has a real chance of succeeding.
const RETRYABLE_CATEGORIES: FailureCategory[] = ["network", "timeout"];

const defaultTaskRunner = new TaskRunner();
let isRunning = false;

// Shared by the API server and the scheduler so a slow/stuck run never overlaps with another --
// only one Playwright session drives the form at a time. `runFn` defaults to the real
// `TaskRunner.run` (which launches a browser + calls the LLM); tests inject a fake to exercise
// the merging/locking/retry/status logic here without any of that.
export async function runExclusive(
  data: Partial<MedicalFormData> = {},
  runFn: (data: MedicalFormData, runId: string) => Promise<WorkflowResult> = (d, runId) =>
    defaultTaskRunner.run(d, runId),
  { maxAttempts = DEFAULT_MAX_ATTEMPTS, retryDelayMs = DEFAULT_RETRY_DELAY_MS }: RetryOptions = {}
): Promise<RunOutcome> {
  const runId = generateRunId();
  const log = createRunLogger(runId);

  if (isRunning) {
    log.warn("run.skipped", { reason: "another run is already in progress" });
    return { runId, status: "skipped", error: "A run is already in progress, try again shortly." };
  }

  isRunning = true;
  try {
    const merged: MedicalFormData = { ...exampleFormData, ...data };

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const result = await runFn(merged, runId);
        // Trust the DOM-verified `submitted` flag, not just whether generateText() threw -- the
        // LLM can finish "successfully" from its own perspective even when the actual submission
        // failed. Not retryable (see RETRYABLE_CATEGORIES comment above).
        if (!result.submitted) {
          log.warn("outcome.verification_failed", { summary: result.text });
          return {
            runId,
            status: "failed",
            summary: result.text,
            error: "Submission was not confirmed on the page.",
            category: "verification",
            screenshotPath: result.screenshotPath,
          };
        }
        return { runId, status: "completed", summary: result.text };
      } catch (e) {
        const category = e instanceof CategorizedError ? e.category : "unknown";
        const willRetry = attempt < maxAttempts && RETRYABLE_CATEGORIES.includes(category);

        if (willRetry) {
          log.warn("run.retrying", {
            attempt,
            maxAttempts,
            category,
            message: (e as Error).message,
          });
          await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
          continue;
        }

        log.error("outcome.exception", { category, message: (e as Error).message, attempt, maxAttempts });
        return { runId, status: "failed", error: (e as Error).message, category };
      }
    }

    // Unreachable -- the loop above always returns on its last iteration -- but keeps the
    // function's return type honest without a non-null assertion.
    throw new Error("runExclusive: retry loop exited without a result");
  } finally {
    isRunning = false;
  }
}
