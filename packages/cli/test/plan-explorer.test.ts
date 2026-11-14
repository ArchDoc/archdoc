import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { planReadAnswer, planRespondAnswer, triageWaitAnswer } from "@archdoc/analyzers";
import { type Browser, chromium, type Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parse } from "yaml";
import { startViewServer, type ViewServer } from "../src/index.js";

// The person's side of the Build tabs, end to end: archdoc view serves the
// built explorer, a browser drives the Plan tab the way a person does (start
// a plan, click on the map and add a note or a box from the menu there, read
// a box in Explore, take turns with the agent: accept what it proposes and
// answer its question in the conversation) and the Triage tab
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

/** Clicks the map where no box, arrow, or control is: the system as a whole. */
async function clickPane() {
  const map = await page.locator(".react-flow").boundingBox();
  if (!map) throw new Error("No map");
  const point = await page.evaluate((m) => {
    // The page's document, without the DOM types this package doesn't build with.
    const doc = (
      globalThis as unknown as {
        document: {
          elementFromPoint(x: number, y: number): { classList: { contains(c: string): boolean } };
        };
      }
    ).document;
    for (let y = m.y + 80; y < m.y + m.height - 80; y += 20)
      for (let x = m.x + 80; x < m.x + m.width - 80; x += 20) {
        if (doc.elementFromPoint(x, y)?.classList.contains("react-flow__pane")) return { x, y };
      }
    return undefined;
  }, map);
  if (!point) throw new Error("No empty place on the map");
  await page.mouse.click(point.x, point.y);
  await page.waitForTimeout(200);
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

    // The person drives the design: it's their turn, and nothing to send until they've said
    // what they want.
    await page.locator(".plan-head").getByText("Your turn").waitFor();
    expect(await page.getByRole("button", { name: /^Send to agent/ }).count()).toBe(0);

    // A click in the API's box opens a small menu there: what the box is, and what to add.
    await clickNode("Orders API");
    const menu = page.getByRole("menu", { name: "Add to Orders API" });
    await menu.waitFor();
    await menu.getByText("Takes orders and charges for them").waitFor();
    await menu.getByRole("menuitem", { name: /New note/ }).click();
    const popover = page.getByRole("dialog", { name: "What you want in Orders API" });
    await popover.waitFor();
    await popover.getByLabel("What you want here").fill("Email a receipt once the charge succeeds");
    await popover.getByLabel("What you want here").press("Enter");
    // It goes to the agent at once: a turn each.
    await expect.poll(spec).toMatchObject({
      intents: [{ id: "i1", on: "api", text: "Email a receipt once the charge succeeds" }],
      unread: [{ id: "i1", what: "added" }],
      status: "reviewing",
      sent: 1,
    });
    const at = (await spec())?.intents?.[0]?.at;
    expect(at?.x).toBeGreaterThan(50);
    expect(at?.y).toBeGreaterThan(50);
    await page.locator(".plan-head").getByText("Sent · waiting for your agent").waitFor();

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
    await expect.poll(async () => (await spec())?.sent).toBe(2);

    // The agent picks it up: the person sees it working.
    expect((await planReadAnswer({ cwd }, { id: ID })).ok).toBe(true);
    await expect.poll(async () => (await spec())?.seen).toBe(2);
    await page.locator(".plan-head").getByText("Agent is working").waitFor();

    // It works out the architecture for i1, and asks a question on it: the person's turn again.
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
    await expect.poll(async () => (await spec())?.answered).toBe(2);
    await page.locator(".plan-head").getByText("Your turn").waitFor();
    // The answer shows under what the person said, in the conversation.
    const chat = page.getByRole("region", { name: "Conversation with the agent" });
    await chat.getByText("Which provider?").waitFor();
    await chat.getByRole("button", { name: "Accept" }).first().click();
    await expect.poll(async () => (await spec())?.changes?.[0]?.status).toBeUndefined();
    await expect.poll(() => chat.getByRole("button", { name: "Accept" }).count()).toBe(0);
    await node("Mailer").waitFor();

    // The box at the bottom answers the agent's open question, and sends it.
    await page.getByText("Answering: Which provider?").waitFor();
    await page.getByLabel("Your answer").fill("Our usual one");
    await page.getByLabel("Your answer").press("Enter");
    await expect
      .poll(async () => (await spec())?.notes?.[0])
      .toMatchObject({ resolved: true, replies: [{ kind: "answer", text: "Our usual one" }] });
    await expect.poll(async () => (await spec())?.sent).toBe(3);
    expect((await spec())?.unread).toEqual(
      expect.arrayContaining([
        { id: "c1", what: "accepted" },
        { id: "n1", what: "replied" },
      ]),
    );

    // Picking a level showed the whole system; the map can show only what the plan touches.
    await node("Shopper").waitFor();
    await page.getByRole("button", { name: "Only what it touches" }).click();
    await expect.poll(() => node("Shopper").count()).toBe(0);
    await page.waitForTimeout(800); // the map fits what's shown
    await fitView();

    // A click on the map itself: a new box in the system, there to draw arrows to.
    await clickPane();
    const sys = page.getByRole("menu", { name: "Add to the system" });
    await sys.getByRole("menuitem", { name: /New element/ }).click();
    const box = page.getByRole("dialog", { name: "New element in the system" });
    await box.getByLabel("Its name").fill("Receipt store");
    await box.getByLabel("What it's for").fill("Keeps each receipt we send");
    await box.getByRole("button", { name: "Add to the map" }).click();
    await expect.poll(spec).toMatchObject({
      changes: expect.arrayContaining([
        expect.objectContaining({
          id: "c2",
          add: { id: "receipt-store", kind: "container", name: "Receipt store" },
          intent: "Keeps each receipt we send",
        }),
      ]),
      intents: expect.arrayContaining([
        expect.objectContaining({
          id: "i2",
          on: "receipt-store",
          text: "Keeps each receipt we send",
        }),
      ]),
      sent: 4,
    });
    await node("Receipt store").waitFor();

    // Explore: a click reads the box instead of adding to it.
    await page.getByRole("button", { name: "Explore" }).click();
    await clickNode("Orders API");
    await page.locator(".plan-panel .lede", { hasText: "Takes orders and charges" }).waitFor();
    expect(await page.getByRole("menu").count()).toBe(0);
    await page.getByRole("button", { name: "＋ Add" }).click();

    // Drag from one box to another, the new one included: what should change between them.
    await page.waitForTimeout(800);
    await fitView();
    const from = await node("Orders API").boundingBox();
    const to = await node("Receipt store").boundingBox();
    if (!from || !to) throw new Error("No boxes");
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 10 });
    await page.mouse.up();
    const between = page.getByRole("dialog", { name: /between Orders API → Receipt store/ });
    await between.waitFor();
    await between.getByRole("textbox").fill("Record each receipt it sends");
    await between.getByRole("textbox").press("Enter");
    await expect
      .poll(async () => (await spec())?.intents?.[2])
      .toMatchObject({
        id: "i3",
        on: "api",
        to: "receipt-store",
        text: "Record each receipt it sends",
      });

    // Click an arrow, or its label: the same, for the two boxes it joins. The map keeps
    // drawing its arrows as the plan changes.
    await page.getByRole("button", { name: "Whole system" }).click();
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
            item: { on: "i3", kind: "question", text: "Which store?", options: ["Postgres", "S3"] },
          },
        ],
      },
    );
    const sent = (await spec())?.sent;
    const choice = page.getByRole("group", { name: "Answer n2" }).first();
    await choice.getByRole("button", { name: "Postgres" }).click();
    await expect
      .poll(async () => (await spec())?.notes?.[1])
      .toMatchObject({
        resolved: true,
        replies: [{ kind: "answer", text: "Postgres" }],
      });
    await expect.poll(async () => (await spec())?.sent).toBe(sent + 1);
    expect(errors).toEqual([]);
  }, 120_000);

  it("sends a pasted bug to the agent, and sends it again with what to do", async () => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    // A fresh load: a hash change alone races the explorer, which can write the last test's
    // #plan=… back into the address before a reload reads it.
    await page.goto("about:blank");
    await page.goto(`${server.url}/#triage`);
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
