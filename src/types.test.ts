import { test } from "node:test";
import assert from "node:assert/strict";
import { partialMedicalFormDataSchema } from "./types";

test("partialMedicalFormDataSchema accepts a valid partial body", () => {
  const result = partialMedicalFormDataSchema.safeParse({ firstName: "Alice", lastName: "Smith" });
  assert.equal(result.success, true);
});

test("partialMedicalFormDataSchema accepts an empty body (every field is optional)", () => {
  const result = partialMedicalFormDataSchema.safeParse({});
  assert.equal(result.success, true);
});

test("partialMedicalFormDataSchema rejects a malformed dateOfBirth", () => {
  const result = partialMedicalFormDataSchema.safeParse({ dateOfBirth: "not-a-date" });
  assert.equal(result.success, false);
});

test("partialMedicalFormDataSchema rejects an empty-string required-looking field", () => {
  const result = partialMedicalFormDataSchema.safeParse({ firstName: "" });
  assert.equal(result.success, false);
});

test("partialMedicalFormDataSchema rejects the wrong type for a field", () => {
  const result = partialMedicalFormDataSchema.safeParse({ firstName: 12345 });
  assert.equal(result.success, false);
});

test("partialMedicalFormDataSchema rejects unrecognized fields", () => {
  const result = partialMedicalFormDataSchema.safeParse({ firstName: "Alice", notAField: "hi" });
  assert.equal(result.success, false);
});
