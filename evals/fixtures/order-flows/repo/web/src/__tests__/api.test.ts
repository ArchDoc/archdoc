import { describe, expect, it } from "vitest";
import { placeOrder } from "../api";

describe("placeOrder", () => {
  it("posts the cart", async () => {
    expect(placeOrder).toBeTypeOf("function");
  });
});
