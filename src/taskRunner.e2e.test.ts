import "dotenv-defaults/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import { TaskRunner } from "./taskRunner";
import { exampleFormData } from "./types";

// Real end-to-end check: launches an actual headed browser, drives the real live site, and makes
// a real Gemini API call. Unlike the rest of the suite, this costs time, network, and API tokens,
// and its outcome depends on the live site being up and the LLM behaving -- so it's deliberately
// NOT part of `npm test` (see the separate `npm run test:e2e` script in package.json). Run it
// on-demand (after a dependency upgrade, before a demo, etc.), not on every commit.
test(
  "TaskRunner fills out and submits the real Medical Information Form end-to-end",
  { timeout: 120_000 },
  async () => {
    const taskRunner = new TaskRunner();
    const result = await taskRunner.run(exampleFormData);

    assert.equal(result.submitted, true, `Expected a verified submission. Agent said: ${result.text}`);
    assert.match(result.confirmationText ?? "", /submitted successfully/i);
  }
);
