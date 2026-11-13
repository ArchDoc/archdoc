import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { planRespondAnswer, triageWaitAnswer } from "@archdoc/analyzers";
import { type Browser, chromium, type Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parse } from "yaml";
import { startViewServer, type ViewServer } from "../src/index.js";

// The person's side of the Build tabs, end to end: archdoc view serves the
// built explorer, a browser drives the Plan tab the way a person does (start
// a plan, click in a box and say what they want there, change it, send it,
// accept what the agent proposes and answer its question) and the Triage tab
// (paste a bug and send it to the agent, then send it again), and the files
// on disk are checked after each step.

const root = fileURLToPath(new URL("../../../", import.meta.url));
const web = join(root, "apps/web/dist");

/** A Chrome or Chromium to drive: ARCHDOC_E2E_CHROME, Playwright's, or the system's. */
function findBrowser(): string | undefined {
  const candidates = [
    process.env.ARCHDOC_E2E_CHROME,
    (() => {
      try {
        return chromium.executablePath();
      } catch {
        return undefined;
      }
    })(),
    "/opt/pw-browsers/chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ];
  return candidates.find((c): c is string => !!c && existsSync(c));
}

const executablePath = findBrowser();
// CI must run it; a machine without a browser skips it.
if (!executablePath && process.env.CI) throw new Error("No Chrome for the explorer test.");

const ID = "email-a-receipt";
let cwd: string;
let server: ViewServer;
let browser: Browser;
let page: Page;

const planFile = () => join(cwd, ".archdoc/plans", `${ID}.yaml`);
const spec = async () =>
  existsSync(planFile()) ? parse(await readFile(planFile(), "utf8")) : undefined;
/** The node on the map showing this name. */
const node = (name: string) => page.locator(".react-flow__node", { hasText: name }).first();

type Edges = { left: number; right: number; top: number; bottom: number };

/** Zooms the map out until every box is in view. */
async function fitView() {
  const map = await page.locator(".react-flow").boundingBox();
  if (!map) throw new Error("No map");
  for (let i = 0; i < 6; i++) {
    const boxes = await page.$$eval(".react-flow__node", (ns) =>
      ns.map((n) => {
        const r = (n as unknown as { getBoundingClientRect(): Edges }).getBoundingClientRect();
        return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
      }),
    );
    const inside = boxes.every(
      (b) =>
        b.left >= map.x &&
        b.right <= map.x + map.width &&
        b.top >= map.y &&
        b.bottom <= map.y + map.height,
    );
    if (inside) return;
    await page.locator(".react-flow__controls-zoomout").click();
    await page.waitForTimeout(250);
  }
}

/** Clicks in a box, clear of its handles and its label's links. */
async function clickNode(name: string) {
  const box = await node(name).boundingBox();
  if (!box) throw new Error(`No box for ${name}`);
  await page.mouse.click(box.x + box.width - 24, box.y + box.height - 10);
  await page.waitForTimeout(200);
}

beforeAll(async () => {
  if (!executablePath) return;
  if (!existsSync(join(web, "index.html")))
    execFileSync("pnpm", ["-s", "-F", "@archdoc/web", "build"], { cwd: root, stdio: "ignore" });
  cwd = await mkdtemp(join(tmpdir(), "archdoc-plan-explorer-"));
  await mkdir(join(cwd, ".archdoc"), { recursive: true });
  await writeFile(
    join(cwd, ".archdoc", "archdoc.yaml"),
    [
      'archdoc: "2.0"',
      "namespace: shop",
      "actors:",
      "  shopper: { kind: person, name: Shopper, uses: { web: Shops } }",
      "elements:",
      "  web: { kind: container, name: Storefront, description: The storefront, uses: { api: Places orders } }",
      "  api: { kind: container, name: Orders API, description: Takes orders and charges for them }",
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
  server = await startViewServer({ target: ".", cwd, webDir: web, watch: true });
  browser = await chromium.launch({ executablePath, args: ["--no-sandbox"] });
  page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  // ARCHDOC_E2E_SLOW=4 runs the page as on a CPU four times slower, as CI's can be.
  const slow = Number(process.env.ARCHDOC_E2E_SLOW ?? 0);
  if (slow > 1)
    await (await page.context().newCDPSession(page)).send("Emulation.setCPUThrottlingRate", {
      rate: slow,
    });
}, 180_000);

afterAll(async () => {
  await browser?.close();
  await server?.close();
  if (cwd) await rm(cwd, { recursive: true, force: true });
});

describe.skipIf(!executablePath)("the explorer's Build tabs", () => {
  it("lets a person say what they want on the map, send it, and answer the agent", async () => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`${server.url}/#plan`);

    // Start a plan from the list: the idea, its first line the title.
    await page.getByRole("button", { name: "+ Start a plan" }).click();
    await page
      .getByPlaceholder(/Email the shopper a receipt/)
      .fill("Email a receipt\nEmail the shopper a receipt once checkout charges the order");
    await page.getByRole("button", { name: "Start the plan" }).click();
    await expect
      .poll(spec)
      .toMatchObject({ plan: ID, title: "Email a receipt", status: "drafting" });

    // The containers, so the storefront and the API are boxes of their own.
    await page.locator(".react-flow__node").first().waitFor();
    await page.getByRole("button", { name: "Containers", exact: true }).click();
    await node("Orders API").waitFor();
    await fitView();

    // The person drives the design: nothing to send until they've said what they want.
    expect(await page.getByRole("button", { name: /^Send to agent/ }).isDisabled()).toBe(true);

    // Click in the API's box: a popover opens there for what they want. No form, no kinds.
    await clickNode("Orders API");
    const popover = page.getByRole("dialog", { name: "What you want in Orders API" });
    await popover.waitFor();
    await popover.getByLabel("What you want here").fill("Email a receipt once the charge succeeds");
    await popover.getByLabel("What you want here").press("Enter");
    await expect.poll(spec).toMatchObject({
      intents: [{ id: "i1", on: "api", text: "Email a receipt once the charge succeeds" }],
      unread: [{ id: "i1", what: "added" }],
    });
    const at = (await spec())?.intents?.[0]?.at;
    expect(at?.x).toBeGreaterThan(50);
    expect(at?.y).toBeGreaterThan(50);

    // It's a pin in the box; clicking it opens the popover to change it.
    await page.locator(".intent-pin").first().click();
    const edit = page.getByRole("dialog", { name: "Intent i1" });
    await edit
      .getByLabel("What you want here")
      .fill("Email a receipt once the charge goes through");
    await edit.getByRole("button", { name: "Save" }).click();
    await expect
      .poll(async () => (await spec())?.intents?.[0]?.text)
      .toBe("Email a receipt once the charge goes through");

    // Send it to the agent.
    await page.getByRole("button", { name: /Send to agent \(1\)/ }).click();
    await expect.poll(spec).toMatchObject({ status: "reviewing", sent: 1 });

    // The agent works out the architecture for i1, and asks a question on it.
    const answer = await planRespondAnswer(
      { cwd },
      {
        id: ID,
        by: "agent:claude",
        ops: [
          {
            op: "put",
            list: "changes",
            item: {
              for: ["i1"],
              intent: "Sends the receipt",
              add: { id: "mailer", kind: "container", name: "Mailer" },
            },
          },
          {
            op: "put",
            list: "notes",
            item: { on: "i1", kind: "question", text: "Which provider?" },
          },
        ],
      },
    );
    expect(answer.ok).toBe(true);
    await page.getByRole("button", { name: "Accept" }).first().waitFor({ timeout: 10_000 });
    await page.getByRole("button", { name: "Accept" }).first().click();
    await expect.poll(async () => (await spec())?.changes?.[0]?.status).toBeUndefined();
    await expect.poll(() => page.getByRole("button", { name: "Accept" }).count()).toBe(0);
    await node("Mailer").waitFor();

    // Answer the question, and resolve it.
    const form = page.locator("form", { has: page.getByLabel("Reply to n1") }).first();
    await form.getByLabel("Reply to n1").fill("Our usual one");
    const send = form.getByRole("button", { name: "Answer" });
    await expect.poll(() => send.isEnabled()).toBe(true);
    await send.click();
    await expect
      .poll(async () => (await spec())?.notes?.[0]?.replies?.[0])
      .toMatchObject({ kind: "answer", text: "Our usual one" });
    await page.getByRole("button", { name: "Resolve" }).first().click();
    await expect.poll(async () => (await spec())?.notes?.[0]?.resolved).toBe(true);
    expect((await spec())?.unread).toEqual(
      expect.arrayContaining([
        { id: "c1", what: "accepted" },
        { id: "n1", what: "replied" },
      ]),
    );

    // Picking a level showed the whole system; the map can show only what the plan touches.
    await page.getByText("Showing the whole system").waitFor();
    await node("Shopper").waitFor();
    await page.getByRole("button", { name: "Show only what it touches" }).click();
    await page.getByText("Showing what the plan touches").waitFor();
    await expect.poll(() => node("Shopper").count()).toBe(0);

    // Drag from one box to another: what should change between them.
    await page.waitForTimeout(800); // the map fits what's shown
    await fitView();
    const from = await node("Orders API").boundingBox();
    const to = await node("Mailer").boundingBox();
    if (!from || !to) throw new Error("No boxes");
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 10 });
    await page.mouse.up();
    const between = page.getByRole("dialog", { name: /between Orders API → Mailer/ });
    await between.waitFor();
    await between.getByRole("textbox").fill("Hand the receipt over on a queue");
    await between.getByRole("textbox").press("Enter");
    await expect
      .poll(async () => (await spec())?.intents?.[1])
      .toMatchObject({
        id: "i2",
        on: "api",
        to: "mailer",
        text: "Hand the receipt over on a queue",
      });

    // Click an arrow, or its label: the same, for the two boxes it joins. The map keeps
    // drawing its arrows as the plan changes.
    await page.locator(".edge-note", { hasText: "Places orders" }).click();
    await page.getByRole("dialog", { name: /between Storefront → Orders API/ }).waitFor();
    await page.keyboard.press("Escape");

    // A question with choices: one tap answers it, settles it, and sends it.
    await planRespondAnswer(
      { cwd },
      {
        id: ID,
        by: "agent:claude",
        ops: [
          {
            op: "put",
            list: "notes",
            item: { on: "i2", kind: "question", text: "Which queue?", options: ["SQS", "Redis"] },
          },
        ],
      },
    );
    const choice = page.getByRole("group", { name: "Answer n2" }).first();
    await choice.getByRole("button", { name: "SQS" }).click();
    await expect
      .poll(async () => (await spec())?.notes?.[1])
      .toMatchObject({
        resolved: true,
        replies: [{ kind: "answer", text: "SQS" }],
      });
    await expect.poll(async () => (await spec())?.sent).toBe(2);
    expect(errors).toEqual([]);
  }, 120_000);

  it("sends a pasted bug to the agent, and sends it again with what to do", async () => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`${server.url}/#triage`);
    await page.reload();
    const dir = join(cwd, ".archdoc/triage");
    const record = async () => {
      const files = existsSync(dir) ? await readdir(dir) : [];
      return files[0] ? parse(await readFile(join(dir, files[0]), "utf8")) : undefined;
    };

    // Paste the bug and send it: the record is written, marked sent, with the ask.
    await page.getByRole("button", { name: "+ Start a triage" }).click();
    await page
      .locator(".triage-paste textarea")
      .fill("Error: receipt never sent\n    at placeOrder (api/orders.ts:42:7)");
    await page.getByRole("button", { name: "Send to agent: find the root cause" }).click();
    await expect.poll(record).toMatchObject({ sent: 1, ask: "Find the root cause" });

    // The agent waiting with archdoc triage wait picks it up.
    const picked = await triageWaitAnswer({ cwd }, { timeout: 1, interval: 50 });
    expect(picked.text).toMatch(/^The person sent .+, asking: Find the root cause\./);

    // The record opens; send it again from its header, asking for a fix.
    await page.getByText(/Sent to your agent/).waitFor();
    await page.getByRole("button", { name: "Find and fix it" }).click();
    await expect.poll(record).toMatchObject({ sent: 2, ask: "Find the root cause and fix it" });
    expect(errors).toEqual([]);
  }, 60_000);
});
