import { tool } from "ai";
import { z } from "zod";
import type { Page } from "playwright";
import { Mutex } from "./mutex";

const SECTION_NAMES = [
  "Personal Information",
  "Medical Information",
  "Emergency Contact",
] as const;
const ACTION_TIMEOUT = 5000;

export interface FormSessionState {
  submitted: boolean;
  confirmationText?: string;
}

// Every wait below is explicitly bounded -- no Playwright call in this file relies on an implicit
// default timeout, so a stuck/unresponsive page fails fast (ACTION_TIMEOUT) instead of hanging.
function snapshot(page: Page, timeout = ACTION_TIMEOUT): Promise<string> {
  return page.locator("body").ariaSnapshot({ timeout });
}

function buildTools(page: Page, mutex: Mutex, state: FormSessionState) {
  return {
    fillFields: tool({
      description:
        "Fill multiple fields in one section in one action. Optionally provide sectionToOpen ONLY when that section is currently closed; its header is a toggle. Choose exact labels and values from the page and supplied data. Use kind text for text inputs or dropdown for select options. Returns individual outcomes and one updated page snapshot. Retry only failed fields.",
      inputSchema: z.object({
        sectionToOpen: z.enum(SECTION_NAMES).optional(),
        fields: z
          .array(
            z.object({
              kind: z.enum(["text", "dropdown"]),
              label: z.string().min(1),
              value: z.string(),
            }),
          )
          .min(1)
          .max(10),
      }),
      execute: async ({ fields, sectionToOpen }) =>
        mutex.run(async () => {
          const outcomes: {
            label: string;
            success: boolean;
            error?: string;
          }[] = [];
          // Stay below TaskRunner's 10-second tool deadline even when several fields fail.
          const deadline = Date.now() + 8000;
          const remaining = () =>
            Math.max(1, Math.min(ACTION_TIMEOUT, deadline - Date.now()));
          if (sectionToOpen) {
            try {
              await page
                .getByRole("button", { name: sectionToOpen, exact: true })
                .click({ timeout: remaining() });
              const first = fields[0];
              await page
                .getByRole(first.kind === "dropdown" ? "combobox" : "textbox", {
                  name: first.label,
                  exact: true,
                })
                .waitFor({ state: "visible", timeout: remaining() });
            } catch (error) {
              return {
                outcomes: fields.map((field) => ({
                  label: field.label,
                  success: false,
                  error: `Cannot open section: ${(error as Error).message}`,
                })),
                pageState: await snapshot(page, remaining()).catch(
                  () => "Page state unavailable",
                ),
              };
            }
          }
          for (const field of fields) {
            try {
              if (Date.now() >= deadline)
                throw new Error(
                  "Group time budget exhausted; retry this field.",
                );
              const locator = page.getByRole(
                field.kind === "dropdown" ? "combobox" : "textbox",
                { name: field.label, exact: true },
              );
              // Reject inaccessible fields immediately instead of accumulating per-field timeouts.
              if (!(await locator.isVisible()))
                throw new Error(
                  "Field is not visible; open its section first.",
                );
              if (field.kind === "dropdown") {
                await locator.selectOption(
                  { label: field.value },
                  { timeout: remaining() },
                );
              } else {
                await locator.fill(field.value, { timeout: remaining() });
              }
              outcomes.push({ label: field.label, success: true });
            } catch (error) {
              outcomes.push({
                label: field.label,
                success: false,
                error: (error as Error).message,
              });
            }
          }
          const pageState = await snapshot(page, remaining()).catch(
            () => "Page state unavailable; read page state before continuing.",
          );
          return { outcomes, pageState };
        }),
    }),
    getPageState: tool({
      description:
        "Get a snapshot (accessibility tree) of what's currently visible on the form: fields, buttons, and sections. Call this first, and whenever you're unsure what's currently visible or already filled in.",
      inputSchema: z.object({}),
      execute: async () =>
        mutex.run(async () => {
          try {
            return await snapshot(page);
          } catch (e) {
            return `Error reading page state: ${(e as Error).message}. The page may have closed.`;
          }
        }),
    }),

    openSection: tool({
      description:
        "Expand one of the form's collapsible sections by clicking its header. Only one section is open at a time -- opening a new one collapses whichever was previously open, but values already entered are preserved. This is a TOGGLE: only call it on a section that is currently CLOSED (i.e. its fields are not visible in the page state). Calling it on a section that is already open will collapse it instead of doing nothing.",
      inputSchema: z.object({
        section: z.enum(SECTION_NAMES),
      }),
      execute: async ({ section }) =>
        mutex.run(async () => {
          try {
            await page
              .getByRole("button", { name: section, exact: true })
              .click({ timeout: ACTION_TIMEOUT });
            await page.waitForTimeout(400);
            return `Opened "${section}". Current state:\n${await snapshot(page)}`;
          } catch (e) {
            return `Error opening section "${section}": ${(e as Error).message}`;
          }
        }),
    }),

    fillField: tool({
      description:
        "Type a value into a text, date, or phone input, or a textarea, identified by its exact visible label (e.g. 'First Name', 'Date of Birth', 'Allergies'). The field's section must already be open.",
      inputSchema: z.object({
        label: z.string().describe("The exact visible label text of the field"),
        value: z.string(),
      }),
      execute: async ({ label, value }) =>
        mutex.run(async () => {
          try {
            await page
              .getByRole("textbox", { name: label, exact: true })
              .fill(value, { timeout: ACTION_TIMEOUT });
            return `Filled "${label}" with "${value}". Current state:\n${await snapshot(page)}`;
          } catch (e) {
            return `Error filling "${label}": ${(e as Error).message}. Make sure its section is open first.`;
          }
        }),
    }),

    selectDropdown: tool({
      description:
        "Choose an option from a dropdown, identified by its visible label (e.g. 'Gender', 'Blood Type') and the option's exact visible text (e.g. 'Male', 'A+'). The field's section must already be open.",
      inputSchema: z.object({
        label: z.string(),
        optionText: z.string(),
      }),
      execute: async ({ label, optionText }) =>
        mutex.run(async () => {
          try {
            await page
              .getByRole("combobox", { name: label, exact: true })
              .selectOption({ label: optionText }, { timeout: ACTION_TIMEOUT });
            return `Selected "${optionText}" for "${label}". Current state:\n${await snapshot(page)}`;
          } catch (e) {
            return `Error selecting "${optionText}" for "${label}": ${(e as Error).message}. Make sure its section is open first.`;
          }
        }),
    }),

    submitForm: tool({
      description:
        "Click the Submit button. Only call this once every required field has been filled. Do not call any other tool after this one -- just report the result.",
      inputSchema: z.object({}),
      execute: async () =>
        mutex.run(async () => {
          try {
            await page
              .getByRole("button", { name: "Submit", exact: true })
              .click({ timeout: ACTION_TIMEOUT });
            // Wait for asynchronous confirmation rather than reading before the UI updates.
            await page
              .waitForFunction(
                () => /submitted successfully/i.test(document.body.innerText),
                {},
                { timeout: ACTION_TIMEOUT },
              )
              .catch(() => undefined);
            const bodyText = await page
              .evaluate(() => document.body.innerText)
              .catch(() => "");
            state.submitted = /submitted successfully/i.test(bodyText);
            state.confirmationText = bodyText;
            return `Clicked Submit. Page now shows:\n${bodyText}\n\n(Do not call any more tools -- just report this result.)`;
          } catch (e) {
            return `Error submitting form: ${(e as Error).message}`;
          }
        }),
    }),
  };
}

// The AI-SDK tools the agent uses to drive the Medical Information Form: reading page state,
// navigating its accordion sections, filling fields, and submitting. Ground truth about whether
// the form was actually submitted is captured directly from the DOM by submitForm itself, exposed
// via `state` -- independent of whatever the LLM narrates afterward. Every tool tolerates the
// page disappearing mid-call instead of throwing an unhandled error.
export class FormFiller {
  readonly state: FormSessionState = { submitted: false };
  readonly tools: ReturnType<typeof buildTools>;

  constructor(page: Page) {
    this.tools = buildTools(page, new Mutex(), this.state);
  }
}
