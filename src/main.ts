import { TaskRunner } from "./taskRunner";
import { exampleFormData } from "./types";
import { CategorizedError } from "./errors";

// CLI entrypoint (`npm run dev`): runs a single task with the hardcoded example data.
export async function main() {
  const taskRunner = new TaskRunner();
  try {
    await taskRunner.run(exampleFormData);
  } catch (e) {
    const category = e instanceof CategorizedError ? e.category : "unknown";
    console.error(`\n[${category}] ${(e as Error).message}`);
    process.exitCode = 1;
  }
}
