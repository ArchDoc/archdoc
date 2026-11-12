import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { planEditAnswer } from "@archdoc/analyzers";
import { parsePlan } from "@archdoc/core";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createArchdocServer } from "../src/index.js";

// archdoc_plan at each stage, as an agent calls it: start, wait for the
// person (who edits the plan the way the explorer does), read, respond within
// the agent's rules, and mark tasks as it carries the plan out.

let cwd: string;
let client: Client;
const ID = "email-a-receipt";
const spec = async () => {
  const file = join(cwd, ".archdoc/plans", `${ID}.yaml`);
  const { plan } = parsePlan(file, await readFile(file, "utf8"));
  if (!plan) throw new Error(`${ID} doesn't parse`);
  return plan.spec;
};
const person = (ops: unknown[]) =>
  planEditAnswer({ cwd }, { id: ID, by: "human:@dana", track: true, ops: ops as never });

async function plan(args: Record<string, unknown>) {
  const r = await client.callTool({ name: "archdoc_plan", arguments: args });
  const content = r.content as { type: string; text: string }[];
  return { text: content[0]?.text ?? "", isError: r.isError === true };
}

beforeAll(async () => {
  cwd = await mkdtemp(join(tmpdir(), "archdoc-mcp-plan-"));
  await mkdir(join(cwd, ".archdoc"), { recursive: true });
  await writeFile(
    join(cwd, ".archdoc", "archdoc.yaml"),
    [
      'archdoc: "2.0"',
      "namespace: shop",
      "actors:",
      "  shopper: { kind: person }",
      "elements:",
      "  web: { kind: container, description: The storefront, uses: { api: Places orders } }",
      "  api: { kind: container, description: Takes orders and charges for them }",
      "journeys:",
      "  checkout:",
      "    actor: shopper",
      "    goal: Buy what's in the cart",
      "    steps:",
      "      - { from: shopper, to: web, action: Checks out }",
      "      - { from: web, to: api, action: Places the order }",
      "",
    ].join("\n"),
  );
  const server = createArchdocServer({ cwd });
  const [a, b] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: "test", version: "0" });
  await Promise.all([server.connect(a), client.connect(b)]);
});

afterAll(async () => {
  await client.close();
  await rm(cwd, { recursive: true, force: true });
});

describe("archdoc_plan, stage by stage", () => {
  it("says what each action needs", async () => {
    const r = await plan({ action: "start" });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/start needs/);
    expect((await plan({ action: "respond", id: ID })).text).toMatch(/needs id and ops/);
  });

  it("start: writes the plan with its scope, and the steps that follow", async () => {
    const r = await plan({
      action: "start",
      goal: "Email the shopper a receipt once checkout charges the order",
      title: "Email a receipt",
    });
    expect(r.isError).toBe(false);
    expect(r.text).toMatch(/archdoc view --detach --watch --open/);
    expect(r.text).toMatch(/action wait/);
    expect(await spec()).toMatchObject({
      plan: ID,
      status: "drafting",
      scope: { elements: ["api"], journeys: ["checkout"] },
    });
    expect((await plan({ action: "list" })).text).toMatch(/email-a-receipt · Email a receipt/);
  });

  it("wait: returns once the person sends, with what they changed first", async () => {
    await person([
      { op: "put", list: "intents", item: { on: "api", text: "Email a receipt once it's paid" } },
      {
        op: "put",
        list: "changes",
        item: { intent: "Sends the receipt", add: { id: "mailer", kind: "container" } },
      },
    ]);
    expect((await plan({ action: "wait", id: ID, timeout: 0.1 })).text).toMatch(/Still waiting/);
    await person([{ op: "send" }]);
    const r = await plan({ action: "wait", id: ID, timeout: 1 });
    expect(r.text).toMatch(/Changed by the person since your last read \(2\)/);
    expect(r.text).toMatch(/Respond with these ops/);
    expect((await spec()).unread ?? []).toEqual([]);
    // Sent again with nothing new: read says so rather than waiting.
    expect((await plan({ action: "read", id: ID })).text).not.toMatch(/since your last read/);
  });

  it("respond: keeps the agent to notes and suggestions", async () => {
    const refused = await plan({
      action: "respond",
      id: ID,
      by: "agent:claude",
      ops: [
        { op: "put", list: "changes", item: { id: "c1", intent: "x", add: { id: "mail" } } },
        { op: "send" },
      ],
    });
    expect(refused.isError).toBe(true);
    expect(refused.text).toMatch(/that's the person's/);
    expect(refused.text).toMatch(/only the person sends a plan/);
    expect((await spec()).changes).toHaveLength(1);

    const r = await plan({
      action: "respond",
      id: ID,
      by: "agent:claude",
      ops: [
        {
          op: "put",
          list: "changes",
          item: {
            intent: "The API sends it after the charge",
            for: ["i1"],
            use: { from: "api", to: "mailer" },
          },
        },
        { op: "put", list: "notes", item: { on: "c1", kind: "question", text: "Which provider?" } },
      ],
    });
    expect(r.isError).toBe(false);
    const s = await spec();
    expect(s.changes[1]).toMatchObject({ id: "c2", status: "suggested", by: "agent:claude" });
    expect(s.notes[0]).toMatchObject({ id: "n1", kind: "question", on: "c1" });
  });

  it("task: carries it out, from ready to executing to done", async () => {
    await person([
      { op: "accept", id: "c2" },
      { op: "reply", note: "n1", text: "Our usual one", kind: "answer" },
      { op: "resolve", note: "n1" },
      { op: "set", status: "ready" },
    ]);
    const ready = await plan({ action: "read", id: ID });
    expect(ready.text).toMatch(/accepted c2/);
    expect(ready.text).toMatch(/archdoc edit: \{"op":"use","from":"api","to":"mailer"/);
    expect(ready.text).toMatch(/write the tasks/);

    await plan({
      action: "respond",
      id: ID,
      by: "agent:claude",
      ops: [{ op: "put", list: "tasks", item: { title: "Add the mailer", from: ["c1", "c2"] } }],
    });
    expect((await plan({ action: "task", id: ID, task: "t1", status: "doing" })).isError).toBe(
      false,
    );
    expect((await spec()).status).toBe("executing");
    expect((await plan({ action: "task", id: ID, task: "t2" })).isError).toBe(true);
    await plan({ action: "task", id: ID, task: "t1", status: "done" });
    expect((await spec()).status).toBe("done");
  });
});
