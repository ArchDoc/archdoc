import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parse } from "yaml";
import {
  planEditAnswer,
  planListAnswer,
  planReadAnswer,
  planRespondAnswer,
  planStartAnswer,
  planTaskAnswer,
  planWaitAnswer,
} from "../src/index.js";

let cwd: string;
const where = () => ({ cwd });
const file = (id: string) => join(cwd, ".archdoc", "plans", `${id}.yaml`);
const spec = async (id: string) => parse(await readFile(file(id), "utf8"));

beforeAll(async () => {
  cwd = await mkdtemp(join(tmpdir(), "archdoc-plan-"));
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
      "  api: { kind: container, description: Takes orders }",
      "",
    ].join("\n"),
  );
});

afterAll(() => rm(cwd, { recursive: true, force: true }));

describe("archdoc plan", () => {
  let id = "";

  it("starts a plan from the idea, as drafting, and says how to go on", async () => {
    const r = await planStartAnswer(where(), {
      goal: "Email the shopper a receipt",
      by: "human:@dana",
    });
    expect(r.ok).toBe(true);
    id = r.id ?? "";
    expect(id).toBe("email-the-shopper-a-receipt");
    expect(await spec(id)).toMatchObject({ plan: id, status: "drafting", by: "human:@dana" });
    expect(r.text).toMatch(/archdoc plan wait/);
    const again = await planStartAnswer(where(), { goal: "Email the shopper a receipt" });
    expect(again.id).toBe(`${id}-2`);
  });

  it("records what the person draws as unread, and returns from wait when they send", async () => {
    const drawn = await planEditAnswer(where(), {
      id,
      by: "human:@dana",
      track: true,
      ops: [
        {
          op: "put",
          list: "intents",
          item: { on: "api", text: "Email the receipt once it's paid" },
        },
        {
          op: "put",
          list: "changes",
          item: { intent: "Sends mail", add: { id: "mailer", kind: "container" } },
        },
      ],
    });
    expect(drawn.ok).toBe(true);
    const waiting = await planWaitAnswer(where(), { id, timeout: 0.1 });
    expect(waiting.text).toMatch(/Still waiting/);
    await planEditAnswer(where(), { id, by: "human:@dana", track: true, ops: [{ op: "send" }] });
    const sent = await planWaitAnswer(where(), { id, timeout: 1 });
    expect(sent.text).toMatch(/added i1/);
    expect(sent.text).toMatch(/added c1/);
  });

  it("clears unread when the agent reads it, unless it peeks", async () => {
    await planEditAnswer(where(), {
      id,
      by: "human:@dana",
      track: true,
      ops: [{ op: "set", goal: "Email the shopper a receipt once they pay" }],
    });
    await planEditAnswer(where(), {
      id,
      by: "human:@dana",
      track: true,
      ops: [{ op: "put", list: "notes", item: { text: "Plain text is fine" } }],
    });
    const peek = await planReadAnswer(where(), { id, peek: true });
    expect(peek.text).toMatch(/since your last read \(1\)/);
    expect((await spec(id)).unread).toHaveLength(1);
    await planReadAnswer(where(), { id });
    expect((await spec(id)).unread).toBeUndefined();
  });

  it("makes the agent's changes suggestions, and refuses edits to the person's", async () => {
    const refused = await planRespondAnswer(where(), {
      id,
      by: "agent:claude",
      ops: [
        { op: "put", list: "changes", item: { id: "c1", intent: "x", add: { id: "mail" } } },
        { op: "accept", id: "c1" },
      ],
    });
    expect(refused.ok).toBe(false);
    expect(refused.text).toMatch(/that's the person's/);
    expect(refused.text).toMatch(/only the person accepts/);

    const ok = await planRespondAnswer(where(), {
      id,
      by: "agent:claude",
      ops: [
        {
          op: "put",
          list: "changes",
          item: { intent: "The API sends it", for: ["i1"], use: { from: "api", to: "mailer" } },
        },
        { op: "put", list: "notes", item: { on: "c1", kind: "question", text: "SMTP?" } },
      ],
    });
    expect(ok.ok).toBe(true);
    const s = await spec(id);
    expect(s.changes[1]).toMatchObject({ id: "c2", status: "suggested", by: "agent:claude" });
    expect(s.notes[1]).toMatchObject({ id: "n2", kind: "question", by: "agent:claude" });
    expect(s.unread).toBeUndefined();
    // Answering hands the turn back: the round it read is answered.
    expect(s).toMatchObject({ sent: 1, seen: 1, answered: 1 });
    expect(ok.text).toMatch(/plan wait\) right away/);
  });

  it("returns from wait at once when a round was sent the agent hasn't read", async () => {
    await planEditAnswer(where(), { id, by: "human:@dana", track: true, ops: [{ op: "send" }] });
    // Read without unread: the round is still the agent's to read, and wait says so at once.
    await planEditAnswer(where(), { id, by: "agent:claude", ops: [{ op: "read" }] });
    await planEditAnswer(where(), { id, by: "human:@dana", track: false, ops: [{ op: "send" }] });
    const s = await spec(id);
    expect(s.sent).toBeGreaterThan(s.seen);
    const started = Date.now();
    const r = await planWaitAnswer(where(), { id, timeout: 5 });
    expect(r.text).toMatch(/^The person sent/);
    expect(Date.now() - started).toBeLessThan(2000);
    expect((await spec(id)).seen).toBe(s.sent);
  });

  it("returns from wait at once when the person already marked the plan ready", async () => {
    await planEditAnswer(where(), {
      id,
      by: "human:@dana",
      track: true,
      ops: [{ op: "set", status: "ready" }],
    });
    // The agent reads it first, so nothing is unread or behind: only the status says stop.
    await planEditAnswer(where(), { id, by: "agent:claude", ops: [{ op: "read" }] });
    const started = Date.now();
    const r = await planWaitAnswer(where(), { id, timeout: 5 });
    expect(r.text).toMatch(/^The person sent .*\(ready\)/);
    expect(Date.now() - started).toBeLessThan(2000);
    await planEditAnswer(where(), {
      id,
      by: "human:@dana",
      ops: [{ op: "set", status: "reviewing" }],
    });
  });

  it("lists plans with what's open", async () => {
    const r = await planListAnswer(where(), {});
    expect(r.text).toMatch(/1 open question/);
    expect(r.text).toMatch(/1 suggestion/);
  });

  it("sets the plan executing, then done, as tasks land", async () => {
    await planEditAnswer(where(), {
      id,
      by: "human:@dana",
      track: true,
      ops: [
        { op: "accept", id: "c2" },
        { op: "resolve", note: "n2" },
        { op: "set", status: "ready" },
      ],
    });
    await planRespondAnswer(where(), {
      id,
      by: "agent:claude",
      ops: [{ op: "put", list: "tasks", item: { title: "Add the mailer", from: ["c1", "c2"] } }],
    });
    await planTaskAnswer(where(), { id, task: "t1", status: "doing" });
    expect((await spec(id)).status).toBe("executing");
    await planTaskAnswer(where(), { id, task: "t1", status: "done" });
    expect((await spec(id)).status).toBe("done");
  });

  it("takes the person's intents, and the agent's changes for them, never the agent's intents", async () => {
    const started = await planStartAnswer(where(), {
      goal: "Log receipts\nKeep a copy of each",
      by: "human:@dana",
    });
    const pid = started.id ?? "";
    expect((await spec(pid)).title).toBe("Log receipts");
    await planEditAnswer(where(), {
      id: pid,
      by: "human:@dana",
      track: true,
      ops: [
        {
          op: "put",
          list: "intents",
          item: { on: "api", at: { x: 50, y: 50 }, text: "Keep a copy" },
        },
      ],
    });
    const early = await planRespondAnswer(where(), {
      id: pid,
      by: "agent:claude",
      ops: [{ op: "put", list: "changes", item: { intent: "A store", add: { id: "copies" } } }],
    });
    expect(early.ok).toBe(false);
    expect(early.text).toMatch(/hasn't said what they want yet/);
    await planEditAnswer(where(), {
      id: pid,
      by: "human:@dana",
      track: true,
      ops: [{ op: "send" }],
    });
    const refused = await planRespondAnswer(where(), {
      id: pid,
      by: "agent:claude",
      ops: [
        { op: "put", list: "intents", item: { text: "Mine" } },
        { op: "put", list: "changes", item: { intent: "Unasked", add: { id: "cache" } } },
        { op: "put", list: "changes", item: { intent: "x", for: ["i7"], add: { id: "cache" } } },
      ],
    });
    expect(refused.ok).toBe(false);
    expect(refused.text).toMatch(/intents are the person's/);
    expect(refused.text).toMatch(/say which of the person's intents/);
    expect(refused.text).toMatch(/i7 isn't an intent the person wrote/);
    const ok = await planRespondAnswer(where(), {
      id: pid,
      by: "agent:claude",
      ops: [
        {
          op: "put",
          list: "changes",
          item: {
            intent: "Stores copies",
            for: ["i1"],
            add: { id: "receipts", kind: "datastore" },
          },
        },
      ],
    });
    expect(ok.ok).toBe(true);
    expect((await spec(pid)).changes[0]).toMatchObject({ for: ["i1"], status: "suggested" });
    expect((await planReadAnswer(where(), { id: pid })).text).toMatch(
      /i1 on api \(carried out by c1\)/,
    );
  });
});
