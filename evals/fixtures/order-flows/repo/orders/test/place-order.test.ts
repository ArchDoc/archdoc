import { expect, it, vi } from "vitest";
import { placeOrder } from "../src/checkout/place-order";
import { published } from "../src/testing/fake-publisher";

vi.mock("../src/events/publisher", () => import("../src/testing/fake-publisher"));
vi.mock("../src/store/orders-repo", () => ({
  insertOrder: async (o: object) => ({ id: "1", ...o }),
}));

it("publishes order.placed", async () => {
  await placeOrder("a@example.com", [{ sku: "mug", quantity: 1 }]);
  expect(published).toHaveLength(1);
});
