import * as http from "node:http";
import { runExclusive } from "./exclusiveRunner";
import { partialMedicalFormDataSchema } from "./types";
import { systemLog } from "./logger";

const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;

function readJsonBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res: http.ServerResponse, statusCode: number, body: unknown) {
  res.writeHead(statusCode, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

export function startServer() {
  const server = http.createServer(async (req, res) => {
    if (req.method === "POST" && req.url === "/run") {
      systemLog.info("api.request_received", { method: req.method, url: req.url });
      try {
        const rawBody = await readJsonBody(req);
        const parsed = partialMedicalFormDataSchema.safeParse(rawBody);
        if (!parsed.success) {
          const issues = parsed.error.issues.map(
            (issue) => `${issue.path.join(".") || "(body)"}: ${issue.message}`
          );
          systemLog.warn("api.invalid_request", { issues });
          sendJson(res, 400, { status: "failed", error: "Invalid request body", issues });
          return;
        }

        const outcome = await runExclusive(parsed.data);
        const statusCode = outcome.status === "completed" ? 200 : outcome.status === "skipped" ? 409 : 500;
        systemLog.info("api.request_completed", {
          runId: outcome.runId,
          statusCode,
          status: outcome.status,
          category: outcome.category,
        });
        sendJson(res, statusCode, outcome);
      } catch (e) {
        systemLog.error("api.request_failed", { message: (e as Error).message });
        sendJson(res, 400, { status: "failed", error: (e as Error).message });
      }
      return;
    }

    if (req.method === "GET" && req.url === "/health") {
      sendJson(res, 200, { ok: true });
      return;
    }

    systemLog.warn("api.not_found", { method: req.method, url: req.url });
    sendJson(res, 404, { error: "Not found" });
  });

  server.listen(PORT, () => {
    systemLog.info("api.server_started", { port: PORT });
    console.log(
      `POST /run with a JSON body (e.g. {"firstName":"Alice","lastName":"Smith"}) to trigger a run. Omitted fields fall back to the example data.`
    );
  });

  return server;
}
