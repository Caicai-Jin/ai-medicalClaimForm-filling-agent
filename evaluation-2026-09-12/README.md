# AI Form-Filling Agent: 100-record evaluation

Completed September 12, 2026. All inputs are synthetic. Nothing was pushed to GitHub.

## Results
- Records attempted: 100/100, each in its own sequential browser run.
- Confirmed submissions: 100/100.
- Confirmed submissions with matching captured input fields: 100/100.
- Failed records: 0; field-mismatch records: 0.
- Record attempts: 100.
- Median processing time: 15.53 seconds; p95: 17.74 seconds.
- Sum of per-record durations: 25.16 minutes (includes browser startup and cleanup; excludes setup/packaging).
- Completed model requests: 1380; input tokens: 3815149, including 492081 cached; output/reasoning tokens: 84882.
- Standard paid-price equivalent: US$5.82. This is an estimate, NOT the account's actual charge. Free-tier/billing status was not independently verified. Pricing basis: input $1.50/M, cached input $0.15/M, output including reasoning $9/M, from https://ai.google.dev/gemini-api/docs/pricing checked September 10, 2026.

## Method
Used the supplied project's Gemini 3.5 Flash model, prompts, form tools and sequential batch runner against https://magical-medical-form.netlify.app/. Used headless Microsoft Edge through the bundled Playwright runtime because the supplied browser runtime failed to launch. Restored locked dependencies in an isolated copy. The four fixed source/test files match the original project folder; hashes are included.

The observer reads actual textbox values and selected option labels after tool actions, compares them with CSV inputs, and separately checks the agent's DOM-confirmed submission flag. This checks captured browser-entry fidelity, not independent server-side storage or every hidden field at submission time. It does not prove that a backend saved the records. A success toast alone is not treated as field accuracy.

Cases vary names (including accents, apostrophes and hyphens), valid dates, dropdown choices, empty optional fields, commas, quotation marks, and longer text. One fixed demo form and one run were evaluated; results do not establish performance on arbitrary websites or future runs.

The evaluation wrapper records thrown errors as nonretryable to avoid repeated spending. No record retries occurred in the completed run. SDK-internal retry activity is not independently counted, and retry recovery is not established by this benchmark.

## Fixes and supporting checks
- Batch records no longer inherit example-patient defaults; missing optional fields remain missing. Demo/API default behavior remains separate.
- Submission confirmation waits up to five seconds for asynchronous success text.
- Existing suite plus two batch regression tests: 44 passed in the preceding verification; TypeScript noEmit passed again before this benchmark.
- Two free browser checks passed: delayed confirmation is recognized; absent confirmation remains a failure.
- Offline 100-record batch check showed zero default-value substitutions after the fix.
- Separate negative dataset: four of six rejected; impossible calendar date and unsupported gender are still accepted by schema validation. Those are known remaining validation gaps, not part of this successful valid-input cohort.

## Resume bullet
Evaluated an AI form-filling agent on 100 synthetic records, achieving 100% confirmed submissions with matching captured field values and a 15.5-second median processing time in a controlled benchmark.

## Files
patients-100.csv is the reusable Excel-compatible UTF-8 input. benchmark-results.csv contains one row per record. benchmark-100-attempts.jsonl contains field captures and token usage. Source hashes identify the tested files. This folder contains no API key or dependencies. Review before publishing. The original GitHub repository has not been updated by this task.
