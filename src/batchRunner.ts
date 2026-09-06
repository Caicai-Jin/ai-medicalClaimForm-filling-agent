import fs from "node:fs";
import { medicalFormDataSchema, MedicalFormData } from "./types";
import { runExclusive, RunOutcome } from "./exclusiveRunner";
import { systemLog } from "./logger";

export interface PatientRowError {
  line: number;
  raw: string;
  issues: string[];
}

export interface BatchResult {
  total: number;
  completed: number;
  failed: number;
  skippedRows: PatientRowError[];
  outcomes: RunOutcome[];
}

// Minimal RFC-4180-style line parser (quoted fields, escaped "" for a literal quote) so a value
// like an allergy list can contain a comma without a full CSV library dependency.
function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      fields.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  fields.push(current);
  return fields.map((field) => field.trim());
}

// Parses a patient roster CSV into validated records. Each row is checked independently against
// the same `medicalFormDataSchema` the API uses for POST /run -- a malformed row (bad date, a
// missing required field, a typo'd header) is reported and skipped rather than aborting the
// entire batch over one bad line.
export function parsePatientCsv(content: string): { records: MedicalFormData[]; errors: PatientRowError[] } {
  const lines = content.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) {
    return { records: [], errors: [] };
  }

  const headers = parseCsvLine(lines[0]);
  const records: MedicalFormData[] = [];
  const errors: PatientRowError[] = [];

  for (let i = 1; i < lines.length; i++) {
    const raw = lines[i];
    const values = parseCsvLine(raw);
    const row: Record<string, string> = {};
    headers.forEach((header, idx) => {
      const value = values[idx];
      if (value) row[header] = value;
    });

    const parsed = medicalFormDataSchema.safeParse(row);
    if (parsed.success) {
      records.push(parsed.data);
    } else {
      errors.push({
        line: i + 1,
        raw,
        issues: parsed.error.issues.map((issue) => `${issue.path.join(".") || "(row)"}: ${issue.message}`),
      });
    }
  }

  return { records, errors };
}

// Reads a patient roster from a CSV file and drives one form submission per patient. Reuses
// `runExclusive` per patient so each submission gets the same retry/verification/logging
// guarantees as a single API-triggered run. Deliberately sequential (not Promise.all): only one
// Playwright session drives the form at a time, and processing one patient fully before starting
// the next keeps a failure isolated to that patient and the logs readable in submission order.
export async function runBatch(
  filePath: string,
  runFn?: Parameters<typeof runExclusive>[1]
): Promise<BatchResult> {
  const content = fs.readFileSync(filePath, "utf-8");
  const { records, errors } = parsePatientCsv(content);

  for (const error of errors) {
    systemLog.warn("batch.row_skipped", { line: error.line, issues: error.issues });
  }

  const outcomes: RunOutcome[] = [];
  for (const record of records) {
    systemLog.info("batch.patient_started", {
      firstName: record.firstName,
      lastName: record.lastName,
      medicalId: record.medicalId,
    });
    const outcome = await runExclusive(record, runFn);
    outcomes.push(outcome);
    systemLog.info("batch.patient_finished", {
      runId: outcome.runId,
      status: outcome.status,
      firstName: record.firstName,
      lastName: record.lastName,
    });
  }

  const completed = outcomes.filter((outcome) => outcome.status === "completed").length;
  const failed = outcomes.length - completed;

  systemLog.info("batch.finished", {
    total: records.length,
    completed,
    failed,
    skippedRows: errors.length,
  });

  return { total: records.length, completed, failed, skippedRows: errors, outcomes };
}
