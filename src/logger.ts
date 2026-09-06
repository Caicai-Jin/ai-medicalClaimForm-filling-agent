import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export type LogLevel = "info" | "warn" | "error";

const LOG_DIR = path.join(process.cwd(), "logs");
const LOG_FILE = path.join(LOG_DIR, "agent.log");
let dirEnsured = false;

function ensureLogDir() {
  if (dirEnsured) return;
  fs.mkdirSync(LOG_DIR, { recursive: true });
  dirEnsured = true;
}

// Every log line goes to two places: a human-readable line on the console (for whoever's
// watching right now) and a structured JSON line in logs/agent.log (for reconstructing what
// happened later -- e.g. an unattended 3am scheduled run that fails with nobody watching). The
// file is append-only and never truncated by this process; log rotation is a real concern for a
// long-running deployment but is intentionally out of scope here.
function write(level: LogLevel, event: string, data: Record<string, unknown>) {
  const time = new Date().toISOString();
  const entry = { time, level, event, ...data };

  ensureLogDir();
  fs.appendFileSync(LOG_FILE, JSON.stringify(entry) + "\n");

  const prefix = `[${time}] [${level.toUpperCase()}]${data.runId ? ` [${data.runId}]` : ""}`;
  const { runId: _runId, ...rest } = data;
  const details = Object.keys(rest).length > 0 ? ` ${JSON.stringify(rest)}` : "";
  const consoleFn = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
  consoleFn(`${prefix} ${event}${details}`);
}

export function generateRunId(): string {
  return `run-${Date.now().toString(36)}-${crypto.randomBytes(3).toString("hex")}`;
}

// Bound to one runId so every log line from a single execution (API request, scheduled tick, or
// a plain `npm run dev`) can be grepped/correlated together, even when a long-running server's
// log file has many interleaved runs in it.
export function createRunLogger(runId: string) {
  return {
    runId,
    info: (event: string, data: Record<string, unknown> = {}) => write("info", event, { runId, ...data }),
    warn: (event: string, data: Record<string, unknown> = {}) => write("warn", event, { runId, ...data }),
    error: (event: string, data: Record<string, unknown> = {}) => write("error", event, { runId, ...data }),
  };
}

// For events that aren't tied to any single run (server startup, scheduler startup).
export const systemLog = {
  info: (event: string, data: Record<string, unknown> = {}) => write("info", event, data),
  warn: (event: string, data: Record<string, unknown> = {}) => write("warn", event, data),
  error: (event: string, data: Record<string, unknown> = {}) => write("error", event, data),
};
