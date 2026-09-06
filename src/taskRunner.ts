import { generateText, stepCountIs } from "ai";
import path from "node:path";
import { model } from "./_internal/setup";
import { BrowserAgent } from "./browserAgent";
import { FormFiller } from "./formFiller";
import { buildPrompt } from "./promptBuilder";
import { MedicalFormData } from "./types";
import { classifyBrowserError, classifyLlmError } from "./errors";
import { createRunLogger, generateRunId } from "./logger";

// Override via the FORM_URL environment variable (see .env) once you've deployed docs/index.html
// (e.g. via GitHub Pages) -- the fallback below is a local placeholder, not a live site.
const FORM_URL = process.env.FORM_URL || "http://localhost:8123/";
const MAX_STEPS = 25;
const SCREENSHOTS_DIR = path.join(process.cwd(), "screenshots");

// Without this, a hung Gemini call would block generateText() forever -- and since TaskRunner.run()
// is awaited inside exclusiveRunner's concurrency lock, that would permanently jam the whole
// system (no scheduled tick or API request could ever run again). stepMs bounds a single LLM
// round-trip, toolMs bounds a single tool execution (a safety net beyond FormFiller's own
// per-action Playwright timeouts), and totalMs is a hard ceiling on the entire multi-step loop --
// generously above the ~20-30s a normal run takes, but never unbounded.
const GENERATE_TEXT_TIMEOUT = {
  stepMs: 60_000,
  toolMs: 10_000,
  totalMs: 5 * 60_000,
};

export interface WorkflowResult {
  text: string;
  submitted: boolean;
  confirmationText?: string;
  screenshotPath?: string;
}

function truncate(value: string, max = 500): string {
  return value.length > max ? `${value.slice(0, max)}... (${value.length} chars total)` : value;
}

// Drives one execution of the agentic loop end to end: launch a browser (BrowserAgent), hand the
// LLM a set of form-manipulation tools (FormFiller), let it decide what to call and in what order
// until the form is submitted, and guarantee the browser is cleaned up no matter how it ends.
export class TaskRunner {
  constructor(private readonly formUrl: string = FORM_URL) {}

  async run(data: MedicalFormData, runId: string = generateRunId()): Promise<WorkflowResult> {
    const log = createRunLogger(runId);
    const startedAt = Date.now();
    log.info("run.started", {
      firstName: data.firstName,
      lastName: data.lastName,
      medicalId: data.medicalId,
      hasOptionalFields: Boolean(data.gender || data.bloodType || data.emergencyContactName),
    });

    const browserAgent = new BrowserAgent();
    try {
      await browserAgent.launch(this.formUrl);
      log.info("browser.session_created", { url: this.formUrl });
    } catch (e) {
      // No screenshot possible here -- BrowserAgent.launch() itself closes the browser (and the
      // Page never existed) on a partial launch/navigation failure, since there'd be no Page
      // handle for a caller to clean up or capture from otherwise.
      const classified = classifyBrowserError(e);
      log.error("run.failed", {
        category: classified.category,
        message: classified.message,
        durationMs: Date.now() - startedAt,
      });
      throw classified;
    }

    // Best-effort screenshot for the "3am, nobody's watching" case -- a captured image of exactly
    // what the page looked like at the moment of failure is far more useful for debugging than
    // the text-only ariaSnapshot already in the logs. Never lets a screenshot failure mask or
    // replace the real error.
    const captureFailureScreenshot = async (label: string): Promise<string | undefined> => {
      const filePath = path.join(SCREENSHOTS_DIR, `${runId}-${label}.png`);
      return (await browserAgent.screenshot(filePath)) ? filePath : undefined;
    };

    try {
      const formFiller = new FormFiller(browserAgent.getPage());

      let result;
      try {
        result = await generateText({
          model,
          tools: formFiller.tools,
          stopWhen: stepCountIs(MAX_STEPS),
          timeout: GENERATE_TEXT_TIMEOUT,
          prompt: buildPrompt(data),
          onStepFinish: (step) => {
            for (const call of step.toolCalls) {
              log.info("tool.called", { toolName: call.toolName, input: call.input });
            }
            for (const toolResult of step.toolResults) {
              const output =
                typeof toolResult.output === "string" ? toolResult.output : JSON.stringify(toolResult.output);
              log.info("tool.result", { toolName: toolResult.toolName, output: truncate(output) });
            }
          },
        });
      } catch (e) {
        const classified = classifyLlmError(e);
        const screenshotPath = await captureFailureScreenshot("llm-failure");
        log.error("run.failed", {
          category: classified.category,
          message: classified.message,
          durationMs: Date.now() - startedAt,
          screenshotPath,
        });
        throw classified;
      }

      const { state } = formFiller;
      log.info("agent.finished", { text: truncate(result.text) });

      let screenshotPath: string | undefined;
      if (!state.submitted) {
        screenshotPath = await captureFailureScreenshot("not-confirmed");
      }
      log.info(state.submitted ? "submission.verified" : "submission.not_confirmed", {
        confirmationText: state.confirmationText ? truncate(state.confirmationText, 200) : undefined,
        screenshotPath,
      });
      log.info("run.finished", {
        status: state.submitted ? "completed" : "failed",
        durationMs: Date.now() - startedAt,
      });

      return {
        text: result.text,
        submitted: state.submitted,
        confirmationText: state.confirmationText,
        screenshotPath,
      };
    } finally {
      const closed = await browserAgent.close();
      log.info("browser.session_closed", { closedCleanly: closed });
    }
  }
}
