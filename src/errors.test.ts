import { test } from "node:test";
import assert from "node:assert/strict";
import { APICallError } from "ai";
import { classifyBrowserError, classifyLlmError } from "./errors";

test("classifyLlmError flags 401/403 as an API key problem", () => {
  const error = new APICallError({
    message: "API key not valid",
    url: "https://generativelanguage.googleapis.com/...",
    requestBodyValues: {},
    statusCode: 401,
  });

  const result = classifyLlmError(error);
  assert.equal(result.category, "llm");
  assert.match(result.message, /api.?key/i);
});

test("classifyLlmError flags 429 as rate limiting", () => {
  const error = new APICallError({
    message: "Too many requests",
    url: "https://generativelanguage.googleapis.com/...",
    requestBodyValues: {},
    statusCode: 429,
  });

  const result = classifyLlmError(error);
  assert.equal(result.category, "llm");
  assert.match(result.message, /rate-limited/i);
});

test("classifyLlmError flags 5xx as a Gemini server error", () => {
  const error = new APICallError({
    message: "Internal error",
    url: "https://generativelanguage.googleapis.com/...",
    requestBodyValues: {},
    statusCode: 503,
  });

  const result = classifyLlmError(error);
  assert.equal(result.category, "llm");
  assert.match(result.message, /server error/i);
});

test("classifyLlmError flags connection-level errors as network issues", () => {
  const result = classifyLlmError(new Error("getaddrinfo ENOTFOUND generativelanguage.googleapis.com"));
  assert.equal(result.category, "network");
});

test("classifyLlmError flags a hung/timed-out call as category 'timeout', not a generic llm error", () => {
  const result = classifyLlmError(new Error("Operation timed out after 60000ms"));
  assert.equal(result.category, "timeout");
});

test("classifyBrowserError flags navigation failures as network issues", () => {
  const result = classifyBrowserError(
    new Error("page.goto: net::ERR_NAME_NOT_RESOLVED at https://does-not-exist.example/")
  );
  assert.equal(result.category, "network");
});

test("classifyBrowserError falls back to a generic browser category", () => {
  const result = classifyBrowserError(new Error("Something else went wrong"));
  assert.equal(result.category, "browser");
});
