import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPrompt } from "./promptBuilder";
import { exampleFormData } from "./types";

test("buildPrompt includes all required Personal Information fields", () => {
  const prompt = buildPrompt(exampleFormData);
  assert.match(prompt, /First Name: John/);
  assert.match(prompt, /Last Name: Doe/);
  assert.match(prompt, /Date of Birth: 1990-01-01/);
  assert.match(prompt, /Medical ID: 91927885/);
});

test("buildPrompt includes optional fields when present", () => {
  const prompt = buildPrompt(exampleFormData);
  assert.match(prompt, /Gender: Male/);
  assert.match(prompt, /Blood Type: A\+/);
  assert.match(prompt, /Emergency Contact Name: Jane Doe/);
  assert.match(prompt, /Emergency Contact Phone: 555-0100/);
});

test("buildPrompt omits optional fields entirely when not provided", () => {
  const prompt = buildPrompt({
    firstName: "Min",
    lastName: "Imal",
    dateOfBirth: "2000-01-01",
    medicalId: "00000000",
  });
  assert.doesNotMatch(prompt, /Gender:/);
  assert.doesNotMatch(prompt, /Blood Type:/);
  assert.doesNotMatch(prompt, /Allergies:/);
  assert.doesNotMatch(prompt, /Emergency Contact Name:/);
});
