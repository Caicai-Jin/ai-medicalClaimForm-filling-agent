import { APICallError } from "ai";

export type FailureCategory = "browser" | "network" | "llm" | "timeout" | "verification" | "unknown";

export class CategorizedError extends Error {
  readonly category: FailureCategory;

  constructor(category: FailureCategory, message: string) {
    super(message);
    this.name = "CategorizedError";
    this.category = category;
  }
}

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// Turns a failure from createSession() (browser launch, or page.goto() to the target site) into
// a clearly categorized error instead of a raw Playwright stack trace.
export function classifyBrowserError(e: unknown): CategorizedError {
  const message = messageOf(e);

  if (/executabledoesn'texist|failed to launch|browsertype\.launch/i.test(message.replace(/\s+/g, ""))) {
    return new CategorizedError(
      "browser",
      `Failed to launch the browser: ${message}. Try running "npx playwright install".`
    );
  }

  if (/net::ERR_|ERR_NAME_NOT_RESOLVED|ERR_CONNECTION|ERR_INTERNET_DISCONNECTED|page\.goto/i.test(message)) {
    return new CategorizedError("network", `Failed to reach the target site: ${message}`);
  }

  return new CategorizedError("browser", `Browser session error: ${message}`);
}

// Turns a failure from generateText() (the Gemini call) into a clearly categorized error,
// distinguishing auth/rate-limit/server/timeout issues from a genuine network problem reaching
// the API. The AI SDK has no dedicated timeout error class -- a timeout from our own
// GENERATE_TEXT_TIMEOUT config (see taskRunner.ts) just surfaces as a generic error whose message
// mentions "timeout" or "timed out", so that's matched explicitly here rather than falling into
// the generic "llm" bucket, since a timeout is a meaningfully different (and often retryable)
// failure mode from e.g. an invalid API key.
export function classifyLlmError(e: unknown): CategorizedError {
  const rawMessage = messageOf(e);
  if (/timed out|timeout/i.test(rawMessage)) {
    return new CategorizedError("timeout", `Gemini call timed out: ${rawMessage}`);
  }

  if (APICallError.isInstance(e)) {
    const status = e.statusCode;
    if (status === 401 || status === 403) {
      return new CategorizedError(
        "llm",
        `Gemini API rejected the request (HTTP ${status}) -- check GOOGLE_GENERATIVE_AI_API_KEY.`
      );
    }
    if (status === 429) {
      return new CategorizedError("llm", "Gemini API rate-limited this request (HTTP 429).");
    }
    if (status !== undefined && status >= 500) {
      return new CategorizedError("llm", `Gemini API returned a server error (HTTP ${status}).`);
    }
    return new CategorizedError("llm", `Gemini API call failed: ${e.message}`);
  }

  const message = messageOf(e);
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|network/i.test(message)) {
    return new CategorizedError("network", `Network error reaching the Gemini API: ${message}`);
  }

  return new CategorizedError("llm", `LLM call failed: ${message}`);
}
