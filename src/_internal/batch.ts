import "dotenv-defaults/config";
import path from "node:path";
import { runBatch } from "../batchRunner";

// `npm run batch` (optionally: `npm run batch -- path/to/patients.csv`) reads a patient roster and
// submits the form once per patient. Defaults to `patients.csv` at the repo root.
const filePath = process.argv[2] ?? path.join(process.cwd(), "patients.csv");

runBatch(filePath)
  .then((result) => {
    console.log(
      `\nBatch finished: ${result.completed}/${result.total} completed, ${result.failed} failed` +
        (result.skippedRows.length > 0 ? `, ${result.skippedRows.length} row(s) skipped for invalid data` : "") +
        "."
    );
    if (result.failed > 0 || result.skippedRows.length > 0) {
      process.exitCode = 1;
    }
  })
  .catch((e) => {
    console.error(`\n[fatal] ${e instanceof Error ? e.message : e}`);
    process.exitCode = 1;
  });
