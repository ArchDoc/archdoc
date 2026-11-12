import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { planRespondAnswer } from "@archdoc/analyzers";
import { type Browser, chromium, type Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parse } from "yaml";
import { startViewServer, type ViewServer } from "../src/index.js";

// The person's side of a plan, end to end: archdoc view serves the built
// explorer, a browser drives the Plan tab the way a person does (start a
// plan, add an element, draw an arrow, record a sequence, each with its
// intent; accept the agent's suggestion and answer its question; send it),
// and the plan file on disk is checked after each step.

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

/** Drags an arrow from one box's right edge to another's left edge. */
async function drawArrow(from: string, to: string) {
  await fitView();
  // hover checks nothing covers the handle, so the drag starts on it, not on the map.
  await node(from).locator(".react-flow__handle-right").hover();
  await page.mouse.down();
  const target = node(to).locator(".react-flow__handle-left");
  const b = await target.boundingBox();
  if (!b) throw new Error(`No handle on ${to}`);
  await page.mouse.move(b.x + b.width / 2 - 30, b.y + b.height / 2, { steps: 10 });
  await target.hover();
  await page.mouse.up();
}

/** Clicks a box near its top right, clear of its handles and its label's links. */
async function clickNode(name: string) {
  const box = await node(name).boundingBox();
  if (!box) throw new Error(`No box for ${name}`);
  await page.mouse.click(box.x + box.width - 20, box.y + 12);
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
}, 180_000);

afterAll(async () => {
  await browser?.close();
  await server?.close();
  if (cwd) await rm(cwd, { recursive: true, force: true });
});

describe.skipIf(!executablePath)("the explorer's Plan tab", () => {
  it("lets a person start, sketch, and send a plan, and answer the agent", async () => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`${server.url}/#plan`);

    // Start a plan from the list.
    await page.getByRole("button", { name: "+ Start a plan" }).click();
    await page.getByPlaceholder("Export a journey as a PDF").fill("Email a receipt");
    await page
      .getByPlaceholder(/Reviewers want/)
      .fill("Email the shopper a receipt once checkout charges the order");
    await page.getByRole("button", { name: "Start the plan" }).click();
    await expect.poll(spec).toMatchObject({ plan: ID, status: "drafting" });

    // The containers, so the storefront and the API are boxes of their own.
    await page.locator(".react-flow__node").first().waitFor();
    await page.getByRole("button", { name: "Containers", exact: true }).click();
    await node("Orders API").waitFor();

    // Add an element: double-click an empty part of the map. It won't save without intent.
    const pane = await page.locator(".react-flow__pane").boundingBox();
    if (!pane) throw new Error("No map");
    await page.mouse.dblclick(pane.x + 60, pane.y + 60);
    await page.getByLabel("Name", { exact: true }).fill("Mailer");
    const add = page.getByRole("button", { name: "Add to the plan" });
    await expect(add.isDisabled()).resolves.toBe(true);
    await page.getByPlaceholder("What this is for, and why it's needed").fill("Sends the receipt");
    await add.click();
    await expect.poll(spec).toMatchObject({
      changes: [{ id: "c1", intent: "Sends the receipt", add: { id: "mailer", name: "Mailer" } }],
      unread: [{ id: "c1", what: "added" }],
    });

    // Draw an arrow from the API to it, with what it does and why.
    await node("Mailer").waitFor();
    await drawArrow("Orders API", "Mailer");
    await page.getByPlaceholder("Sends the journey's steps to render").fill("Emails the receipt");
    await page
      .getByPlaceholder("What this is for, and why it's needed")
      .fill("Once the charge succeeds");
    await page.getByRole("button", { name: "Add to the plan" }).click();
    await expect
      .poll(async () => (await spec())?.changes?.[1])
      .toMatchObject({
        id: "c2",
        intent: "Once the charge succeeds",
        use: { from: "api", to: "mailer", description: "Emails the receipt" },
      });

    // Record a sequence: who starts it, then each box it goes to.
    await fitView();
    await page.getByRole("button", { name: "New sequence" }).click();
    await clickNode("Shopper");
    await clickNode("Storefront");
    await page.getByLabel(/Their goal/).fill("Get a receipt");
    await page.getByPlaceholder("What happens: Clicks Export").fill("Opens the order page");
    const save = page.getByRole("button", { name: "Add to the plan" });
    await expect(save.isDisabled()).resolves.toBe(true);
    await page.getByPlaceholder(/Intent \(required\)/).fill("Where the shopper sees it was sent");
    await save.click();
    await expect
      .poll(async () => (await spec())?.sequences?.[0])
      .toMatchObject({
        id: "s1",
        actor: "shopper",
        goal: "Get a receipt",
        steps: [{ from: "shopper", to: "web", intent: "Where the shopper sees it was sent" }],
      });

    // Send it to the agent.
    await page.getByRole("button", { name: /Send to agent \(3\)/ }).click();
    await expect.poll(spec).toMatchObject({ status: "reviewing", sent: 1 });

    // The agent answers: a suggestion and a question. The page picks them up.
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
              intent: "Records that it was sent",
              use: { from: "mailer", to: "api", description: "Reports delivery" },
            },
          },
          {
            op: "put",
            list: "notes",
            item: { on: "c1", kind: "question", text: "Which provider?" },
          },
        ],
      },
    );
    expect(answer.ok).toBe(true);
    await page.getByRole("button", { name: "Accept" }).first().waitFor({ timeout: 10_000 });
    await page.getByRole("button", { name: "Accept" }).first().click();
    await expect.poll(async () => (await spec())?.changes?.[2]?.status).toBeUndefined();

    // Answer the question (it's under c1 and in the notes), and resolve it.
    const reply = page.getByLabel("Reply to n1").first();
    await reply.fill("Our usual one");
    await reply.press("Enter");
    await expect
      .poll(async () => (await spec())?.notes?.[0]?.replies?.[0])
      .toMatchObject({
        kind: "answer",
        text: "Our usual one",
      });
    await page.getByRole("button", { name: "Resolve" }).first().click();
    await expect.poll(async () => (await spec())?.notes?.[0]?.resolved).toBe(true);
    expect((await spec())?.unread).toEqual(
      expect.arrayContaining([
        { id: "c3", what: "accepted" },
        { id: "n1", what: "replied" },
      ]),
    );
    expect(errors).toEqual([]);
  }, 120_000);
});
