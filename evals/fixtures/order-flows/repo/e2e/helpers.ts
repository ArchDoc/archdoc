import type { Page } from "@playwright/test";
export async function fillCart(page: Page) {
  await page.goto("/");
  await page.getByLabel("Email").fill("e2e@example.com");
}
