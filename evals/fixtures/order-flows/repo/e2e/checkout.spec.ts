import { expect, test } from "@playwright/test";
import { fillCart } from "./helpers";

test("a customer checks out", async ({ page }) => {
  await fillCart(page);
  await page.getByRole("button", { name: "Place order" }).click();
  await expect(page).toHaveURL(/\/orders\//);
});
