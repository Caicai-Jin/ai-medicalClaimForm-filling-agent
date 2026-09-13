import { test } from "node:test";
import assert from "node:assert/strict";
import type { Page } from "playwright";
import { FormFiller } from "./formFiller";

test("grouped filling opens the selected section before filling and serializes groups", async () => {
  const actions: string[] = [];
  const page = {
    getByRole: (_role: string, { name }: { name: string }) => ({
      click: async () => {
        actions.push(`open:${name}`);
      },
      waitFor: async () => {
        actions.push(`visible:${name}`);
      },
      isVisible: async () => true,
      fill: async (value: string) => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        actions.push(`fill:${value}`);
      },
    }),
    locator: () => ({ ariaSnapshot: async () => "page" }),
  } as unknown as Page;
  const tool = new FormFiller(page).tools.fillFields;
  await Promise.all([
    tool.execute!(
      {
        sectionToOpen: "Medical Information",
        fields: [{ kind: "text", label: "Allergies", value: "None" }],
      },
      { toolCallId: "one", messages: [], context: {} },
    ),
    tool.execute!(
      {
        sectionToOpen: "Emergency Contact",
        fields: [
          { kind: "text", label: "Emergency Contact Name", value: "Alex" },
        ],
      },
      { toolCallId: "two", messages: [], context: {} },
    ),
  ]);
  assert.deepEqual(actions, [
    "open:Medical Information",
    "visible:Allergies",
    "fill:None",
    "open:Emergency Contact",
    "visible:Emergency Contact Name",
    "fill:Alex",
  ]);
});

test("grouped filling continues after a missing field and returns one snapshot", async () => {
  const actions: string[] = [];
  let snapshots = 0;
  const page = {
    getByRole: (role: string, { name }: { name: string }) => ({
      isVisible: async () => name !== "Missing",
      fill: async (value: string) => {
        actions.push(`${role}:${name}:${value}`);
      },
      selectOption: async ({ label }: { label: string }) => {
        actions.push(`${role}:${name}:${label}`);
      },
    }),
    locator: () => ({
      ariaSnapshot: async () => {
        snapshots++;
        return "updated page";
      },
    }),
  } as unknown as Page;
  const tool = new FormFiller(page).tools.fillFields;
  const result = await tool.execute!(
    {
      fields: [
        { kind: "text", label: "First Name", value: "José" },
        { kind: "text", label: "Missing", value: "ignored" },
        { kind: "dropdown", label: "Gender", value: "Other" },
      ],
    },
    { toolCallId: "test", messages: [], context: {} },
  );
  assert.ok("outcomes" in result);
  assert.deepEqual(actions, [
    "textbox:First Name:José",
    "combobox:Gender:Other",
  ]);
  assert.deepEqual(
    result.outcomes.map((item) => item.success),
    [true, false, true],
  );
  assert.match(result.outcomes[1].error!, /not visible/);
  assert.equal(snapshots, 1);
  assert.equal(result.pageState, "updated page");
});

test("grouped filling reports action and snapshot failures without claiming success", async () => {
  const page = {
    getByRole: () => ({
      isVisible: async () => true,
      fill: async () => {
        throw new Error("Page closed");
      },
    }),
    locator: () => ({
      ariaSnapshot: async () => {
        throw new Error("Page closed");
      },
    }),
  } as unknown as Page;
  const result = await new FormFiller(page).tools.fillFields.execute!(
    { fields: [{ kind: "text", label: "First Name", value: "Alex" }] },
    { toolCallId: "test", messages: [], context: {} },
  );
  assert.ok("outcomes" in result);
  assert.equal(result.outcomes[0].success, false);
  assert.match(result.outcomes[0].error!, /Page closed/);
  assert.match(result.pageState, /unavailable/);
});
