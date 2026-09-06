# AI Form-Filling Agent

## Overview

This project is an AI agent that fills out a web form by itself. Instead of writing a script that
clicks the same exact spots every time, I gave an LLM a small set of actions it can take (read the
page, type into a field, click submit, etc.) and let it decide which action to take and when. The
agent also double-checks its own work: after clicking submit, it reads the actual page to confirm
the submission really went through, instead of just trusting whatever the model says happened.

### Core task

Fill out a web form end-to-end, using an example healthcare-intake form as the target:

1. Navigate to the form
2. Fill in:
   1. First Name: John
   2. Last Name: Doe
   3. Date of birth: 1990-01-01
   4. Medical ID: 91927885
3. Click "Submit"

### Additional features

Beyond the core task above, I built 6 more features. Each one is numbered below, and that same
number is used everywhere else in this README (implementation details, and the test walkthrough
further down) so it's easy to go from "what it does" to "how to test it":

1. **Multi-section navigation & dropdowns** -- fills out the form's other two sections too, which
   are collapsed by default and include dropdown fields, not just plain text boxes.
2. **REST API trigger** -- lets someone kick off a run over the network (an API call) instead of
   only from the command line.
3. **Dynamic patient data** -- lets you pass in a different name/patient each time, instead of
   always using the same hardcoded example.
4. **Scheduled runs** -- runs automatically on a timer (every 5 minutes by default), with no one
   needing to trigger it by hand.
5. **DOM-verified submission** -- checks the real page after clicking submit, so it doesn't just
   take the model's word for it.
6. **CSV batch processing** -- reads a list of patients from a CSV file and submits the form once
   for each one, instead of handling only a single patient per run.

### Tech stack

- **Playwright** to drive a real browser session (navigate, read the page, click, type).
- **Google Gemini**, called through the **Vercel AI SDK**, as the model deciding what to do.
  You'll need your own Gemini API key in the `GOOGLE_GENERATIVE_AI_API_KEY` environment variable
  -- you can get a free one from [Google AI Studio](https://aistudio.google.com/apikey).
- **TypeScript** throughout, with `zod` for runtime validation.

## Setup

### System Requirements

- Node.js 20+

### Setup

Clone the repository

Install dependencies

```bash
npm install
```

Install playwright

```bash
npx playwright install
```

Create a `.env` file and add your Gemini API key. The form the agent fills out lives at
`docs/index.html` in this repo -- serve it locally, or deploy it with GitHub Pages, and point
`FORM_URL` at wherever it ends up:

```bash
GOOGLE_GENERATIVE_AI_API_KEY=your_google_key
FORM_URL=http://localhost:8123/            # or https://<your-username>.github.io/<your-repo>/
```

To serve the form locally for development:

```bash
npx serve docs -l 8123
# or: python -m http.server 8123 --directory docs
```

### Running the script

```bash
npm run dev
```

---

## Implementation notes

This section covers what's actually in the code, how to run and check each feature yourself, and
why a few of the less obvious decisions were made -- so you can get a feel for the work without
reading every file.

### File map

Each file has one clear job, so you can tell what it does from its name alone:

| File | Purpose |
|---|---|
| `src/types.ts` | Defines what a patient's data looks like (`MedicalFormData`), an example patient (`exampleFormData`), and the validation rules for that data (built with `zod`), used everywhere else in the project. |
| `src/browserAgent.ts` | **`BrowserAgent`** -- manages one browser session: opens it, navigates, takes screenshots, and always closes it cleanly afterward. Doesn't know anything about the form or the AI model. |
| `src/formFiller.ts` | **`FormFiller`** -- the 5 actions the AI can take on the page (read it, open a section, type into a field, pick a dropdown option, submit), plus the real submitted/not-submitted check. Doesn't know anything about the AI model or scheduling. |
| `src/mutex.ts` | **`Mutex`** -- a small helper that makes sure the agent's actions run one at a time instead of overlapping and colliding with each other. |
| `src/promptBuilder.ts` | `buildPrompt()` -- turns a patient's data into the instructions given to the AI model. |
| `src/taskRunner.ts` | **`TaskRunner`** -- runs one full attempt: opens a browser, lets the AI use `FormFiller`'s actions, logs each step, takes a screenshot if something fails, and cleans up afterward. |
| `src/exclusiveRunner.ts` | `runExclusive()` -- the one place the API, scheduler, and batch runner all go through to start a run; handles making sure only one run happens at a time, merging in custom data, and retrying on failure. |
| `src/main.ts` | Command-line entry point (`npm run dev`): runs one attempt using the example patient data. |
| `src/server.ts` / `src/_internal/serve.ts` | Feature 2 (REST API trigger): plain `node:http` API exposing `POST /run`, with request-body validation. |
| `src/scheduler.ts` / `src/_internal/schedule.ts` | Feature 4 (Scheduled runs): `setInterval`-based 5-minute scheduler. |
| `src/_internal/service.ts` | Runs the API and scheduler together in one process (`npm run start`), so they share one concurrency lock. |
| `src/batchRunner.ts` / `src/_internal/batch.ts` | Feature 6 (CSV batch processing): reads a patient roster from a CSV text file and submits the form once per patient (`npm run batch`). |
| `src/errors.ts` | Sorts errors into categories (`browser`, `network`, `llm`, `timeout`) so the rest of the app can react appropriately, instead of treating every failure the same way. |
| `src/logger.ts` | Logs each run's steps to the console and to `logs/agent.log`, tagged with a run ID so you can trace one run's activity. |
| `logs/`, `screenshots/` | Where run logs and failure screenshots get saved. Not committed to git (see `.gitignore`). |
| `src/mutex.test.ts`, `src/promptBuilder.test.ts`, `src/exclusiveRunner.test.ts`, `src/errors.test.ts`, `src/logger.test.ts`, `src/browserAgent.test.ts`, `src/types.test.ts`, `src/batchRunner.test.ts` | Unit tests, run via `npm test` (see "Testing strategy" below). |
| `src/taskRunner.e2e.test.ts` | A real end-to-end test (actual browser, actual AI call), run separately via `npm run test:e2e` -- not part of `npm test`. |

```
BrowserAgent  ──┐
                ├──> TaskRunner.run() ──> exclusiveRunner.runExclusive() ──> server.ts / scheduler.ts
FormFiller    ──┘         │
                          v
                    promptBuilder, logger, errors
```

### How each feature is implemented

- **Core task**: `TaskRunner` builds a prompt describing the patient's data and hands the AI
  model `FormFiller`'s actions. There's no fixed click-by-click script -- the model looks at the
  page and decides which action to take at each step.
- **Feature 1 -- Multi-section navigation & dropdowns**: same loop as the core task. The model can
  call `openSection` to expand the Medical Information or Emergency Contact section, and
  `selectDropdown` to choose a Gender or Blood Type option.
- **Feature 2 -- REST API trigger**: `npm run serve` starts a small API with one endpoint,
  `POST /run` (see `src/server.ts`).
- **Feature 3 -- Dynamic patient data**: that same `POST /run` endpoint accepts a patient's data
  in the request body. Anything you send overrides the example data; anything you don't send falls
  back to the example (`src/exclusiveRunner.ts`).
- **Feature 4 -- Scheduled runs**: `npm run schedule` runs the agent every 5 minutes on its own
  (or `npm run start` to run the API and the scheduler together). The interval is configurable via
  `SCHEDULE_INTERVAL_MS`, mainly so it's fast to test.
- **Feature 5** and **Feature 6** are two things I added on my own, beyond what was asked, because
  I ran into a real need for them while building this -- explained in full below.

### Feature 5 -- DOM-verified submission (not trusting the LLM's own report)

While testing, the model once said the form had been submitted successfully when the page hadn't
actually shown any success message -- it just guessed wrong. To fix this, right after clicking
Submit, the code reads the actual text on the page and checks it for the real confirmation message,
completely separately from whatever the model says. If that message isn't there, the run is marked
as failed no matter how confident the model's own summary sounds.

### Feature 6 -- CSV batch processing (a whole patient roster in one run)

The core task and the API only handle one patient at a time. In a real setting, though, you'd
usually have a whole batch of intake forms to process, not just one person -- so `npm run batch`
reads a list of patients from a plain CSV file (`patients.csv` by default, or any file path you
pass in) and submits the form once for each patient, automatically.

- `parsePatientCsv()` (`src/batchRunner.ts`) checks every row against the same validation rules the
  API uses. If a row has bad data (a broken date, a missing field, a typo'd column header), it gets
  reported and skipped -- it doesn't stop the rest of the batch from running.
- `runBatch()` then processes each valid patient one at a time, reusing the same run logic as a
  single API request, so every patient gets the same retries, verification, and logging. If one
  patient fails, the rest of the list still runs.
- The CSV's columns match the patient data fields exactly. Any extra columns are ignored, and the
  optional fields (gender, blood type, allergies, medications, emergency contact) can be left blank.

Run it with:

```bash
npm run batch                      # reads ./patients.csv, submits one form per row
npm run batch -- path/to/other.csv # or point it at a different roster file
```

A ready-to-run sample is included at the repo root (`patients.csv`, 3 patients including the example
John Doe). Console output ends with a summary, e.g.:
```
Batch finished: 3/3 completed, 0 failed.
```

### Running each part

```bash
npm run dev                                   # single run, hardcoded example data
npm run serve                                 # API only -- POST /run
npm run schedule                              # scheduler only -- every 5 min
npm run start                                 # API + scheduler together (shared concurrency lock)
npm run batch                                 # reads patients.csv, submits one form per patient
npm test                                      # unit tests (fast, free, no browser/LLM)
npm run test:e2e                              # real end-to-end test against the live site + Gemini
SCHEDULE_INTERVAL_MS=20000 npm run schedule   # scheduler with a short interval, for fast manual testing
```

Example API call with dynamic data:

```bash
curl -X POST http://localhost:3000/run -H "Content-Type: application/json" \
  -d "{\"firstName\":\"Alice\",\"lastName\":\"Smith\",\"medicalId\":\"12345678\"}"
```

### Verifying it yourself, step by step

A concrete walkthrough for manually checking the core task and every feature above, with what to
look for at each step -- useful if you want to try this out yourself rather than just reading the
code.

**0. Clean start**
```bash
npm test
```
Expect `pass 42`, `fail 0` before doing anything else.

**1. Core task** (navigate, fill Personal Information, submit)
```bash
npm run dev
```
A visible browser opens, fills First Name/Last Name/Date of Birth/Medical ID, clicks Submit.
Console ends with:
```
[...] run.finished {"status":"completed",...}
[...] browser.session_closed {"closedCleanly":true}
```

**2. Feature 1 -- Multi-section navigation & dropdowns** (Medical Information + Emergency Contact)
-- same run as step 1, scroll back through the console output and confirm all of these appear:
```
tool.called {"toolName":"openSection","input":{"section":"Medical Information"}}
tool.called {"toolName":"selectDropdown","input":{"label":"Gender","optionText":"Male"}}
tool.called {"toolName":"selectDropdown","input":{"label":"Blood Type","optionText":"A+"}}
tool.called {"toolName":"openSection","input":{"section":"Emergency Contact"}}
```

**3. Feature 5 -- DOM-verified submission** -- same run, right before `run.finished`:
```
submission.verified {"confirmationText":"Form submitted successfully!..."}
```
(*Not* `submission.not_confirmed` -- that would mean the agent claimed success without the page
actually confirming it.)

**4. Feature 2 -- REST API trigger** -- Terminal 1:
```bash
npm run serve
```
Terminal 2:
```bash
curl -X POST http://localhost:3000/run -H "Content-Type: application/json" -d "{}"
```
Expect `{"runId":"...","status":"completed","summary":"..."}` and the browser running the same
flow as step 1.

**5. Feature 3 -- Dynamic patient data** -- same Terminal 2, server still running:
```bash
curl -X POST http://localhost:3000/run -H "Content-Type: application/json" \
  -d "{\"firstName\":\"Alice\",\"lastName\":\"Smith\"}"
```
The browser should actually type "Alice"/"Smith", not the hardcoded John Doe -- proof the data is
truly parameterized, not just defaulted.

Note: only `firstName` and `lastName` were sent here, so every other field (date of birth,
medical ID, gender, etc.) still falls back to the John Doe example data -- that's expected, not a
bug. The merge is "start from the example, then overlay whatever you actually sent"
(`{ ...exampleFormData, ...data }` in `src/exclusiveRunner.ts`), so you can override just the
fields you care about instead of having to send the whole patient every time. To see a fully
custom patient with no John Doe leftovers, send every field:
```bash
curl -X POST http://localhost:3000/run -H "Content-Type: application/json" \
  -d "{\"firstName\":\"Alice\",\"lastName\":\"Smith\",\"dateOfBirth\":\"1985-05-12\",\"medicalId\":\"12345678\",\"gender\":\"Female\",\"bloodType\":\"O+\",\"allergies\":\"Peanuts\",\"medications\":\"Aspirin\",\"emergencyContactName\":\"Bob Smith\",\"emergencyContactPhone\":\"555-0111\"}"
```

Stop the server (Ctrl+C) when done.

**6. Feature 4 -- Scheduled runs** (5-minute schedule)
```bash
SCHEDULE_INTERVAL_MS=20000 npm run schedule
```
Fires immediately, completes, fires again ~20s later. Watch at least 2 full cycles, then Ctrl+C.

**7. Feature 6 -- CSV batch processing** (patient roster from a text file)
```bash
npm run batch
```
Three browser runs happen back-to-back (John Doe, Alice Smith, Carlos Diaz -- from `patients.csv`),
each with its own `run.started`/`submission.verified`/`run.finished` log lines. Console ends with:
```
Batch finished: 3/3 completed, 0 failed.
```

**8. Automated end-to-end proof**
```bash
npm run test:e2e
```
Expect `pass 1`, `fail 0` -- one fully automated test proving the whole pipeline (browser + LLM +
submission) works together, not just each piece manually.

**9. Cleanup check**
```bash
tasklist /FI "IMAGENAME eq node.exe"
```
(Windows) Should be empty once everything above is stopped. See the Windows environment note
further down if you need to check for leftover browser processes too.

### Error handling

Six failure surfaces are handled explicitly, each with a different strategy since they need
different responses:

1. **Missing elements** (a label/field/dropdown option doesn't exist or isn't visible yet) --
   handled _inside_ each tool in `formFiller.ts`. Every tool's `execute` is wrapped in try/catch and
   returns a descriptive error string back to the LLM (e.g. "Make sure its section is open first")
   instead of throwing, so the agent can see what went wrong and self-correct on the next step
   rather than the whole run dying over one bad selector.
2. **Browser failures** (Chromium fails to launch, or crashes) and **network failures** (can't
   reach the target site, or a DNS/connection error talking to the Gemini API) -- these are
   run-ending, not agent-recoverable, so they're classified by `src/errors.ts` into a
   `CategorizedError` (`category: "browser" | "network"`) with a clear message, instead of a raw
   Playwright/Node stack trace.
3. **Gemini/LLM failures** (invalid API key, rate limiting, Gemini server errors, network errors
   reaching the API) -- the `generateText()` call is wrapped separately and classified via
   `classifyLlmError`, which inspects the AI SDK's `APICallError` (`statusCode` 401/403 vs 429 vs
   5xx) to give a specific, actionable message rather than a generic failure.
4. **Guaranteed cleanup** -- `TaskRunner.run()` wraps the LLM call in `try { ... } finally { browserAgent.close() }`,
   so the browser always gets closed on every exit path (success, LLM failure, anything else), not
   just the happy path. `browserAgent.ts` has the matching fix for the launch itself: if `newPage()`
   or `goto()` fails before a `Page` even exists, `BrowserAgent.launch()` closes the browser itself
   before rethrowing, since there'd be no `Page` handle for a caller to clean up otherwise.
5. **Automatic screenshots on failure** -- `BrowserAgent.screenshot()` (best-effort, never throws)
   is called from `TaskRunner` whenever an LLM call fails or the agent finishes without a verified
   submission, saving a full-page PNG to `screenshots/<runId>-<reason>.png`. A screenshot shows
   exactly what the page looked like at the moment of failure -- unexpected popups, layout the
   agent didn't expect, a CAPTCHA -- far more useful for after-the-fact debugging than the
   text-only `ariaSnapshot` already in the logs. The path is included in the log entry and in
   `WorkflowResult`/`RunOutcome` so you know exactly where to look.
6. **Retry logic** -- `exclusiveRunner.runExclusive()` retries up to 3 attempts total (configurable),
   but **only** for `network`/`timeout` categories -- the ones where a second attempt has a real
   chance of succeeding. A `verification` failure (the agent finished but the page never confirmed
   success) or an `llm` failure (e.g. a bad API key) won't be fixed by retrying, so those fail
   immediately instead of wasting an attempt. Each retry is logged (`run.retrying`) with the
   attempt number and reason before a short delay and another try.

All of this surfaces as a `category` field on `RunOutcome` (`src/exclusiveRunner.ts`), so the API
and scheduler can distinguish failure types (`browser` / `network` / `llm` / `timeout` /
`verification` / `unknown`) instead of just a string to grep. Example:

```json
{
  "status": "failed",
  "error": "Failed to reach the target site: page.goto: net::ERR_NAME_NOT_RESOLVED ...",
  "category": "network"
}
```

### Input validation

The `POST /run` body used to be passed straight through with only a compile-time type assertion --
no runtime check at all. `src/types.ts` now derives `MedicalFormData` from a `zod` schema
(`medicalFormDataSchema`), and `server.ts` validates every incoming request against
`partialMedicalFormDataSchema` (`.partial().strict()`) before it ever reaches `exclusiveRunner`:
malformed values (e.g. `dateOfBirth` not matching `YYYY-MM-DD`), wrong types, and unrecognized
fields are all rejected with a `400` and a specific, per-field message instead of silently being
passed to the LLM or crashing later. Example:

```json
{
  "status": "failed",
  "error": "Invalid request body",
  "issues": ["dateOfBirth: dateOfBirth must be in YYYY-MM-DD format"]
}
```

### Timeouts

Nothing in this pipeline waits forever -- every async operation has an explicit, bounded timeout.
The most important one: `TaskRunner.run()` is awaited inside `exclusiveRunner`'s concurrency lock,
so if the Gemini call ever hung with no timeout, the lock would never release and **no scheduled
tick or API request could ever run again** -- the whole system would be permanently jammed, not
just one slow request. Every layer is covered:

| Operation | Where | Bound |
|---|---|---|
| Browser launch | `BrowserAgent.launch()` (`browserAgent.ts`) | `LAUNCH_TIMEOUT_MS` = 30s |
| Page navigation | `BrowserAgent.launch()` (`browserAgent.ts`) | `NAVIGATION_TIMEOUT_MS` = 30s |
| Click / fill / select | `FormFiller` tools (`formFiller.ts`) | `ACTION_TIMEOUT` = 5s per action |
| Reading page state | `FormFiller`'s `snapshot()` helper (`formFiller.ts`) | `ACTION_TIMEOUT` = 5s |
| Failure screenshot | `BrowserAgent.screenshot()` (`browserAgent.ts`) | `SCREENSHOT_TIMEOUT_MS` = 10s (best-effort -- never throws) |
| One LLM round-trip | `generateText()`'s `timeout.stepMs` (`taskRunner.ts`) | 60s |
| One tool execution | `generateText()`'s `timeout.toolMs` (`taskRunner.ts`) | 10s (safety net beyond the 5s Playwright timeouts above, covering e.g. `page.evaluate()` which has no timeout parameter of its own) |
| The entire multi-step loop | `generateText()`'s `timeout.totalMs` (`taskRunner.ts`) | 5 min (normal runs take ~20-30s) |

A hung/timed-out Gemini call has no dedicated error class in the AI SDK, so `classifyLlmError`
(`errors.ts`) explicitly matches "timeout"/"timed out" in the error message and tags it
`category: "timeout"` rather than lumping it in with a generic LLM failure -- distinguishing it
matters because a timeout is usually transient/retryable, unlike e.g. an invalid API key.

### Testing strategy

Three tiers, each answering a different question:

**1. Unit tests (`npm test`)** -- Node's built-in test runner (`node:test`, zero extra
dependencies), fast and free, safe to run on every change:

- `src/mutex.test.ts` -- the `Mutex` actually serializes concurrent calls in the order they were
  issued. This is a **regression test for a real bug**: the AI SDK executes every tool call within
  a step via `Promise.all`, and without this, two "simultaneous" tool calls raced on the same
  Playwright page and produced incorrect behavior (a redundant fill, an accordion section getting
  toggled closed unexpectedly).
- `src/promptBuilder.test.ts` -- `buildPrompt` includes required fields, includes optional fields
  when present, and omits them entirely when not (so the LLM isn't told to fill a field with `undefined`).
- `src/exclusiveRunner.test.ts` -- `runExclusive`'s data merging, its concurrency guard (skips a
  second call while the first is in flight, allows a new one once it finishes), the
  verified-success logic (fails when `submitted: false` even if no error was thrown, fails when
  the task throws, succeeds when `submitted: true`), that a thrown `CategorizedError`'s category
  is surfaced on the outcome, and the retry logic (retries a retryable category and recovers,
  does _not_ retry a non-retryable category, and gives up after `maxAttempts` reporting the last
  failure). Uses dependency injection (a `runFn` parameter standing in for `TaskRunner.run`, plus
  injectable `maxAttempts`/`retryDelayMs`) so these run instantly with no real browser, LLM call,
  or actual waiting involved.
- `src/errors.test.ts` -- `classifyLlmError` maps HTTP 401/403 to an API-key message, 429 to
  rate-limiting, 5xx to a Gemini server error, connection errors to `category: "network"`, and a
  timed-out call to `category: "timeout"` (not lumped in with generic LLM errors);
  `classifyBrowserError` maps a `page.goto` failure to `category: "network"` and falls back to
  `category: "browser"` for anything else.
- `src/logger.test.ts` -- `generateRunId` produces unique ids, and `createRunLogger` writes
  well-formed, correctly-leveled JSON lines tagged with its `runId`.
- `src/browserAgent.test.ts` -- `screenshot()`, `close()`, and `getPage()` all behave safely
  _before_ `launch()` has ever succeeded (no page to screenshot, safe no-op close, clear error
  instead of a null-pointer-style failure).
- `src/types.test.ts` -- `partialMedicalFormDataSchema` accepts valid/empty bodies and rejects a
  malformed `dateOfBirth`, an empty required-looking field, the wrong type, and unrecognized keys.
- `src/batchRunner.test.ts` -- `parsePatientCsv` parses valid rows into `MedicalFormData`, handles
  quoted fields containing commas, and reports a malformed/incomplete row without dropping the
  valid rows around it; `runBatch` (via an injected `runFn`, no real browser) processes patients
  strictly one at a time in file order, isolates one patient's failure from the rest of the roster,
  and surfaces skipped-row counts in its summary.

**2. End-to-end test (`npm run test:e2e`)** -- `src/taskRunner.e2e.test.ts` drives a real
`TaskRunner` against the actual live site with a real Gemini call, and asserts `result.submitted
=== true` and that the real confirmation text is present. This is a genuine, automated proof that
the whole pipeline still works, not just its individual pieces. It's **deliberately not part of
`npm test`**: it costs real time (~20s), a real Gemini API call, and depends on the live site being
up -- appropriate to run on demand (after a dependency upgrade, before a demo) rather than on every
change. It caught a real bug the first time it ran: the test process never loaded `.env`, so the
first attempt failed on a missing API key -- fixed by adding the same `dotenv-defaults/config`
import the other entrypoints already have.

**3. Manual verification** -- the model's exact sequence of tool calls is non-deterministic by
nature (that's the point of an agentic loop), so beyond the one golden-path E2E test above, broader
behavior was verified manually, repeatedly, against the live site:

- Full run via `npm run dev` -- all 3 sections filled correctly, dropdowns selected, confirmed via
  the real success message.
- API run via `npm run serve` + `curl`, including with custom data and a genuine concurrency race
  (two requests fired within milliseconds of each other -- one `completed`, one `skipped`).
- Scheduler run over multiple real cycles (short interval for speed), confirming it fires
  immediately, skips overlapping ticks, and keeps running unattended.
- Post-fix regression check: confirmed via `tasklist`/`Get-Process` (filtered by executable path,
  see the Windows note below) that no browser processes are left behind after a run.

### Notable bugs found and fixed during development

- **Tool-call race condition**: the AI SDK runs tool calls within a step concurrently
  (`Promise.all`), which raced against the shared Playwright `Page` and caused an accordion section
  to get toggled closed unexpectedly. Fixed with the `Mutex` (`mutex.ts`) inside `FormFiller`;
  regression-tested in `mutex.test.ts`.
- **Hallucinated success**: the LLM sometimes reported a successful submission when the page never
  actually confirmed it. Fixed by capturing the real DOM text at submit time and trusting that over
  the model's own words (see "DOM-verified submission" above).
- **Leaked browser processes**: cleanup code skipped closing the Playwright browser whenever the
  page object was already closed, leaking the whole Chromium process tree (GPU/renderer/network
  children included) on every run. Fixed by always attempting `browser.close()` regardless of page
  state (now `BrowserAgent.close()` in `browserAgent.ts`).
- **SDK version mismatch**: the originally scaffolded `ai`/`@ai-sdk/google` versions predated
  Gemini 3.x's `thought_signature` requirement for multi-turn tool calling, which broke the agentic
  loop on the 2nd tool round-trip. Fixed by upgrading both packages (and their `zod` peer dependency)
  to current majors.
- **Leak on the browser launch path**: if `browser.newPage()` or the initial `page.goto()` failed,
  there was no `Page` handle yet for anything to close, so the browser leaked silently. Fixed in
  `BrowserAgent.launch()` (`browserAgent.ts`) by closing the browser itself before rethrowing.
- **Byte-offset vs. character-offset mismatch in a test**: `logger.test.ts` measured "where the log
  file was before this test" in bytes (`fs.statSync(...).size`), then sliced the *decoded string*
  by that same number to isolate the newly written line. That only works if every character in the
  file so far is a single byte. It broke once the log file had an em dash (`—`) in it -- from a
  real AI-generated run summary a few lines earlier -- which is 3 bytes but 1 character, throwing
  the byte-based offset off by 2 per occurrence and truncating the JSON line the test tried to
  parse. Fixed by slicing the raw `Buffer` at the byte offset first, then decoding only that slice
  to a string (`src/logger.test.ts`).
- **Crash-triggered leak on the CLI path**: `npm run dev`'s entrypoint called `main()` without
  awaiting or catching it, so a thrown error became an unhandled promise rejection that crashed
  Node abruptly. That abrupt crash was cutting Windows off before it finished reaping the
  already-closing Chromium child processes -- confirmed by comparing an isolated script that
  exited gracefully (no leak) against the real CLI path failing the same way (25 leaked `chrome.exe`).
  Fixed by properly awaiting/catching in `run.ts` and `main()`, so the process now always exits
  cleanly instead of crashing.

### Environment note (Windows)

On Windows, stopping a long-running `npm run <script>` process doesn't always cascade-kill the
Chromium child processes it launched. If you see odd browser behavior after repeated manual
testing, check for leftovers -- **but filter by executable path, not just process name**.
Playwright's bundled Chromium runs from `...\ms-playwright\chromium-*\...\chrome.exe`, a completely
different binary from your regular installed Google Chrome (`...\Google\Chrome\Application\chrome.exe`)
-- both show up under the same process name "chrome.exe", so a blanket `taskkill /IM chrome.exe /F`
will also close your everyday browser and its tabs if it happens to be open. Use this instead
(PowerShell):

```powershell
Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" |
  Where-Object { $_.ExecutablePath -like "*ms-playwright*" } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
```

### Future improvements

Things intentionally left out of scope for this project, in rough priority order:

- **Log/screenshot rotation and retention** -- `logs/agent.log` and `screenshots/` grow forever
  right now. A long-running deployment would want size- or age-based rotation (or better, shipping
  both to an external store -- e.g. CloudWatch/Datadog for logs, S3 for screenshots -- instead of
  the local filesystem).
- **Exponential backoff on retry** -- the current retry uses a fixed delay (`retryDelayMs`);
  backing off progressively (and adding jitter) would be kinder to a struggling upstream service
  under real load.
- **Auth on the API** -- `POST /run` is unauthenticated. Fine for local use, not for anything
  reachable beyond localhost; would need an API key or similar before that's safe.
- **Run history / a dashboard** -- right now the only record of past runs is the log file. A
  small persisted history (even just SQLite) with a minimal status page would make "did the 3am
  run work?" a much faster question to answer than grepping logs.
- **Alerting on repeated failures** -- if N consecutive scheduled runs fail, something is
  actionable (paged, emailed, Slacked) rather than silently sitting in the logs until someone looks.
- **Configurable target** -- the form URL and field mapping are hardcoded to this one site.
  Generalizing `FormFiller`/`promptBuilder` to take a target/field config would let the same agent
  drive a different form without code changes.
- **CI pipeline** -- a GitHub Actions workflow running `npm test` + `npm run lint` on every push
  would catch regressions before they're manually noticed, and gate `test:e2e` as an optional
  manually-triggered job given its cost.
