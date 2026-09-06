import { test } from "node:test";
import assert from "node:assert/strict";
import { Mutex } from "./mutex";

// Regression test for a real bug found during manual testing: the AI SDK executes every tool
// call within a single step via Promise.all, so without serialization, two "simultaneous" tool
// calls raced on the same Playwright page and produced non-deterministic, incorrect behavior
// (e.g. a redundant field fill, or an accordion section getting toggled closed unexpectedly).

test("Mutex runs queued tasks in call order, not completion order", async () => {
  const mutex = new Mutex();
  const order: number[] = [];

  const task = (id: number, delayMs: number) =>
    mutex.run(async () => {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      order.push(id);
    });

  // Task 1 is slower than task 2 and 3. If these ran concurrently (the bug), 2 or 3 would finish
  // first. The mutex must force them to complete in the order .run() was called.
  await Promise.all([task(1, 30), task(2, 10), task(3, 5)]);

  assert.deepEqual(order, [1, 2, 3]);
});

test("Mutex continues serializing after a queued task throws", async () => {
  const mutex = new Mutex();
  const order: number[] = [];

  const ok = (id: number) =>
    mutex.run(async () => {
      order.push(id);
    });
  const failing = () =>
    mutex.run(async () => {
      throw new Error("boom");
    });

  const results = await Promise.allSettled([ok(1), failing(), ok(3)]);

  assert.equal(results[0].status, "fulfilled");
  assert.equal(results[1].status, "rejected");
  assert.equal(results[2].status, "fulfilled");
  assert.deepEqual(order, [1, 3]);
});
