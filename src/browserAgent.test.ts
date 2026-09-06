import { test } from "node:test";
import assert from "node:assert/strict";
import { BrowserAgent } from "./browserAgent";

test("BrowserAgent.screenshot() returns false (never throws) when launch() hasn't succeeded yet", async () => {
  const browserAgent = new BrowserAgent();
  const result = await browserAgent.screenshot("screenshots/should-not-be-created.png");
  assert.equal(result, false);
});

test("BrowserAgent.getPage() throws a clear error before launch() succeeds", () => {
  const browserAgent = new BrowserAgent();
  assert.throws(() => browserAgent.getPage(), /launch\(\) must succeed/);
});

test("BrowserAgent.close() is a safe no-op before launch() is ever called", async () => {
  const browserAgent = new BrowserAgent();
  const result = await browserAgent.close();
  assert.equal(result, true);
});
