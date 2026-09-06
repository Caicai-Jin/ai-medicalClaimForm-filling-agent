import { test } from "node:test";
import assert from "node:assert/strict";
import { runExclusive } from "./exclusiveRunner";
import { exampleFormData, MedicalFormData } from "./types";
import { CategorizedError } from "./errors";

test("runExclusive merges partial input over the example defaults", async () => {
  let receivedData: MedicalFormData | undefined;
  await runExclusive({ firstName: "Alice", lastName: "Smith" }, async (data) => {
    receivedData = data;
    return { text: "ok", submitted: true };
  });

  assert.equal(receivedData?.firstName, "Alice");
  assert.equal(receivedData?.lastName, "Smith");
  // Fields not passed in should fall back to the example data, not be left undefined.
  assert.equal(receivedData?.dateOfBirth, exampleFormData.dateOfBirth);
  assert.equal(receivedData?.medicalId, exampleFormData.medicalId);
});

test("runExclusive reports failed when the workflow says submitted: false", async () => {
  const outcome = await runExclusive({}, async () => ({
    text: "I think it worked",
    submitted: false,
  }));

  // This mirrors a real case found during manual testing: the LLM can narrate success even when
  // the DOM never actually confirmed the submission. The verified `submitted` flag must win.
  assert.equal(outcome.status, "failed");
  assert.match(outcome.error ?? "", /not confirmed/i);
});

test("runExclusive reports completed when submitted: true", async () => {
  const outcome = await runExclusive({}, async () => ({
    text: "Done",
    submitted: true,
  }));

  assert.equal(outcome.status, "completed");
  assert.equal(outcome.summary, "Done");
});

test("runExclusive reports failed (not a thrown error) if the workflow itself throws", async () => {
  const outcome = await runExclusive({}, async () => {
    throw new Error("browser crashed");
  });

  assert.equal(outcome.status, "failed");
  assert.equal(outcome.error, "browser crashed");
  assert.equal(outcome.category, "unknown");
});

test("runExclusive surfaces the category from a CategorizedError", async () => {
  // maxAttempts: 1 makes this test specifically about category surfacing, not retry behavior
  // (which has its own dedicated tests below) -- "network" is retryable by default.
  const outcome = await runExclusive(
    {},
    async () => {
      throw new CategorizedError("network", "Failed to reach the target site");
    },
    { maxAttempts: 1 }
  );

  assert.equal(outcome.status, "failed");
  assert.equal(outcome.category, "network");
});

test("runExclusive tags a failed verification with category 'verification'", async () => {
  const outcome = await runExclusive({}, async () => ({ text: "maybe?", submitted: false }));
  assert.equal(outcome.category, "verification");
});

test("runExclusive retries a retryable category and succeeds once the failure clears", async () => {
  let callCount = 0;
  const outcome = await runExclusive(
    {},
    async () => {
      callCount++;
      if (callCount === 1) {
        throw new CategorizedError("network", "transient blip");
      }
      return { text: "recovered", submitted: true };
    },
    { retryDelayMs: 0 }
  );

  assert.equal(callCount, 2);
  assert.equal(outcome.status, "completed");
  assert.equal(outcome.summary, "recovered");
});

test("runExclusive does not retry a non-retryable category", async () => {
  let callCount = 0;
  const outcome = await runExclusive(
    {},
    async () => {
      callCount++;
      throw new CategorizedError("llm", "invalid API key");
    },
    { retryDelayMs: 0 }
  );

  assert.equal(callCount, 1);
  assert.equal(outcome.status, "failed");
  assert.equal(outcome.category, "llm");
});

test("runExclusive gives up after maxAttempts and reports the last failure", async () => {
  let callCount = 0;
  const outcome = await runExclusive(
    {},
    async () => {
      callCount++;
      throw new CategorizedError("timeout", "still hanging");
    },
    { maxAttempts: 2, retryDelayMs: 0 }
  );

  assert.equal(callCount, 2);
  assert.equal(outcome.status, "failed");
  assert.equal(outcome.category, "timeout");
});

test("runExclusive skips a second call while the first is still in flight", async () => {
  let releaseFirst: () => void;
  const firstIsRunning = new Promise<void>((resolve) => (releaseFirst = resolve));

  const firstCall = runExclusive({}, async () => {
    await firstIsRunning;
    return { text: "first", submitted: true };
  });

  // Give the first call a chance to set its in-progress flag before firing the second.
  await new Promise((resolve) => setImmediate(resolve));

  const secondOutcome = await runExclusive({}, async () => ({ text: "second", submitted: true }));
  assert.equal(secondOutcome.status, "skipped");

  releaseFirst!();
  const firstOutcome = await firstCall;
  assert.equal(firstOutcome.status, "completed");
  assert.equal(firstOutcome.summary, "first");
});

test("runExclusive allows a new run after the previous one finishes", async () => {
  const first = await runExclusive({}, async () => ({ text: "one", submitted: true }));
  const second = await runExclusive({}, async () => ({ text: "two", submitted: true }));

  assert.equal(first.status, "completed");
  assert.equal(second.status, "completed");
});
