import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRunLogger, generateRunId } from "./logger";

const LOG_FILE = path.join(process.cwd(), "logs", "agent.log");

test("generateRunId produces unique, non-empty ids", () => {
  const ids = new Set(Array.from({ length: 50 }, () => generateRunId()));
  assert.equal(ids.size, 50);
  for (const id of ids) assert.ok(id.length > 0);
});

test("createRunLogger appends a well-formed JSON line per call, tagged with its runId", () => {
  const sizeBefore = fs.existsSync(LOG_FILE) ? fs.statSync(LOG_FILE).size : 0;

  const runId = generateRunId();
  const log = createRunLogger(runId);
  log.info("test.event", { foo: "bar" });

  const content = fs.readFileSync(LOG_FILE, "utf8");
  const newContent = content.slice(sizeBefore);
  const lines = newContent.trim().split("\n");
  const entry = JSON.parse(lines[lines.length - 1]);

  assert.equal(entry.runId, runId);
  assert.equal(entry.event, "test.event");
  assert.equal(entry.foo, "bar");
  assert.equal(entry.level, "info");
  assert.ok(entry.time);
  // Should be a valid, parseable ISO timestamp.
  assert.ok(!Number.isNaN(Date.parse(entry.time)));
});

test("createRunLogger's error level is recorded correctly", () => {
  const runId = generateRunId();
  const log = createRunLogger(runId);
  log.error("test.error_event", { reason: "boom" });

  const content = fs.readFileSync(LOG_FILE, "utf8");
  const lines = content.trim().split("\n");
  const entry = JSON.parse(lines[lines.length - 1]);

  assert.equal(entry.level, "error");
  assert.equal(entry.reason, "boom");
});
