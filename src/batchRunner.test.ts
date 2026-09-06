import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parsePatientCsv, runBatch } from "./batchRunner";

const SAMPLE_CSV = `firstName,lastName,dateOfBirth,medicalId,gender,bloodType,allergies,medications,emergencyContactName,emergencyContactPhone
Alice,Smith,1985-05-12,12345678,Female,O+,Peanuts,Aspirin,Bob Smith,555-0111
Carlos,Diaz,1978-11-03,87654321,Male,B-,None,None,Maria Diaz,555-0122`;

function writeTempCsv(content: string): string {
  const filePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "batch-test-")), "patients.csv");
  fs.writeFileSync(filePath, content);
  return filePath;
}

test("parsePatientCsv parses each row into a validated MedicalFormData record", () => {
  const { records, errors } = parsePatientCsv(SAMPLE_CSV);

  assert.equal(errors.length, 0);
  assert.equal(records.length, 2);
  assert.equal(records[0].firstName, "Alice");
  assert.equal(records[0].lastName, "Smith");
  assert.equal(records[0].bloodType, "O+");
  assert.equal(records[1].medicalId, "87654321");
});

test("parsePatientCsv reports a malformed row without dropping the valid rows around it", () => {
  const csv = `firstName,lastName,dateOfBirth,medicalId
Alice,Smith,1985-05-12,12345678
Bad,Row,not-a-date,999
Carlos,Diaz,1978-11-03,87654321`;

  const { records, errors } = parsePatientCsv(csv);

  assert.equal(records.length, 2);
  assert.equal(records[0].firstName, "Alice");
  assert.equal(records[1].firstName, "Carlos");
  assert.equal(errors.length, 1);
  assert.equal(errors[0].line, 3);
  assert.match(errors[0].issues[0], /dateOfBirth/);
});

test("parsePatientCsv reports a row missing a required field", () => {
  const csv = `firstName,lastName,dateOfBirth,medicalId
,Smith,1985-05-12,12345678`;

  const { records, errors } = parsePatientCsv(csv);
  assert.equal(records.length, 0);
  assert.equal(errors.length, 1);
  assert.match(errors[0].issues[0], /firstName/);
});

test("parsePatientCsv handles quoted fields containing commas", () => {
  const csv = `firstName,lastName,dateOfBirth,medicalId,allergies
Alice,Smith,1985-05-12,12345678,"Peanuts, Shellfish"`;

  const { records, errors } = parsePatientCsv(csv);
  assert.equal(errors.length, 0);
  assert.equal(records[0].allergies, "Peanuts, Shellfish");
});

test("runBatch runs one patient at a time, in file order, via runExclusive", async () => {
  const filePath = writeTempCsv(SAMPLE_CSV);

  const seen: string[] = [];
  let concurrent = 0;
  let maxConcurrent = 0;

  const result = await runBatch(filePath, async (data) => {
    concurrent++;
    maxConcurrent = Math.max(maxConcurrent, concurrent);
    seen.push(data.firstName);
    await new Promise((resolve) => setImmediate(resolve));
    concurrent--;
    return { text: "ok", submitted: true };
  });

  assert.deepEqual(seen, ["Alice", "Carlos"]);
  assert.equal(maxConcurrent, 1);
  assert.equal(result.total, 2);
  assert.equal(result.completed, 2);
  assert.equal(result.failed, 0);
});

test("runBatch isolates a failure to one patient and keeps processing the rest", async () => {
  const filePath = writeTempCsv(SAMPLE_CSV);

  const result = await runBatch(filePath, async (data) => {
    if (data.firstName === "Alice") {
      throw new Error("simulated browser crash");
    }
    return { text: "ok", submitted: true };
  });

  assert.equal(result.total, 2);
  assert.equal(result.completed, 1);
  assert.equal(result.failed, 1);
  assert.equal(result.outcomes[0].status, "failed");
  assert.equal(result.outcomes[1].status, "completed");
});

test("runBatch surfaces skipped rows in the summary without affecting valid patients", async () => {
  const filePath = writeTempCsv(`firstName,lastName,dateOfBirth,medicalId
Alice,Smith,1985-05-12,12345678
Bad,Row,not-a-date,999`);

  const result = await runBatch(filePath, async () => ({ text: "ok", submitted: true }));

  assert.equal(result.total, 1);
  assert.equal(result.completed, 1);
  assert.equal(result.skippedRows.length, 1);
});
