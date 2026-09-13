# Grouped-action performance evaluation — September 13, 2026

The exact same 100 synthetic records were processed sequentially with Gemini 3.5 Flash against https://magical-medical-form.netlify.app/.

| Measurement | September 12 baseline | September 13 optimized evaluation | Supervised visible-browser rerun |
|---|---:|---:|---:|
| Confirmed submissions / matching captured inputs | 100/100 | 100/100 | 100/100 |
| Sum of per-record durations | 25.16 minutes | 14.69 minutes | **13.93 minutes** |
| Average record duration | 15.10 seconds | 8.82 seconds | **8.36 seconds** |
| Median record duration | 15.53 seconds | 8.74 seconds | **8.13 seconds** |
| P95 record duration | 17.74 seconds | 11.03 seconds | **10.30 seconds** |
| Completed model requests | 1,380 | 575 | **575** |
| Input tokens | 3,815,149 | 1,232,199 | Recorded in `rerun-attempts.jsonl` |
| Output tokens, including reasoning | 84,882 | 94,032 | Recorded in `rerun-attempts.jsonl` |

The supervised rerun measured **44.6% less total processing time** than the baseline. The implementation reduced completed model requests by **58.3%**. These are measured results on this form and environment, not guaranteed timing for every run.

## Implementation

The model chooses multiple field/value pairs and an optional closed section to open in one fillFields call. Playwright executes them sequentially under the existing mutex, returns per-field outcomes, and takes one page snapshot. Section opening waits for visibility instead of adding a fixed delay in this new path. Existing single-field tools remain available. Missing fields, failed actions, and exhausted group time budgets are reported; success still requires a browser confirmation. Three new regression tests bring the suite to 47 passing tests. TypeScript checks also passed.

## Evidence and limitations

- patients-100.csv is the exact original dataset, suitable for Excel; records.json is its structured reference.
- `results.csv` and `attempts-100.jsonl` contain the first optimized evaluation. `visible-rerun-results.csv`, `rerun-attempts.jsonl`, and `rerun-0-100.json` contain the later supervised run.
- comparison.json contains both aggregates. The original baseline evidence remains in ../evaluation-2026-09-12/.
- Two separate 10-record pilots tested grouped filling and then combined navigation/filling before the final 100-record run. Their logs are included and excluded from the final timing.
- The baseline and first optimized evaluation used headless Microsoft Edge. The later supervised rerun used visible Microsoft Edge. All ran on the same Windows machine with the same dataset, form, model, and sequential record processing. API, network, and browser latency can change rerun timing.
- Each record includes a fresh browser session and cleanup. Reported time sums per-record durations, excluding command startup and dataset parsing.
- Matching means values captured from browser controls after filling; it does not establish server-side persistence. Blank optional fields compare as empty when not captured. This is a synthetic, single-demo-form test, not a production or concurrent-user benchmark.
- API billing was not verified. Model usage is recorded; do not interpret it as proof of free usage.

## Windows CMD: watch and measure the same 100 records

Run from the project root with a valid local .env containing GOOGLE_GENERATIVE_AI_API_KEY. Dependencies must be installed (npm ci) and a browser available (npx playwright install chromium).

    cd /d "C:\Users\jin20\Downloads\ai-agent-publish"
    set "BENCHMARK_PLAYWRIGHT_MODULE=C:\Users\jin20\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules\playwright"
    set "BENCHMARK_BROWSER_CHANNEL=msedge"
    set "BENCHMARK_HEADLESS=false"
    node evaluation-performance-2026-09-13/benchmark.cjs 100

The browser opens and the final line reports verified records and total processing seconds/minutes. The supervised run took 13.93 minutes; timing can vary. For a quick two-record check, replace 100 with 2. For a headless run, set BENCHMARK_HEADLESS=true. Each rerun replaces `rerun-attempts.jsonl` and its `rerun-*.json` summary; the recorded evidence above remains unchanged.

To run the normal batch entry point instead:

    set "FORM_URL=https://magical-medical-form.netlify.app/"
    npm run batch -- evaluation-performance-2026-09-13/patients-100.csv

To run the free regression suite:

    npm test
    npx tsc --noEmit

## Resume bullet

Optimized an LLM-driven browser automation agent by batching field entry and section navigation, reducing processing time for 100 synthetic records by 45% (25.16 to 13.93 minutes) while confirming 100/100 submissions with matching captured inputs.

Local compatibility note: the two-record smoke check with project Playwright 1.51.1 and installed Edge failed at browser launch before any model request. The CMD command above explicitly selects the same bundled Playwright 1.62.1 used in the successful full benchmark. That module path is specific to this computer; on another machine install a compatible Playwright/browser pair.
