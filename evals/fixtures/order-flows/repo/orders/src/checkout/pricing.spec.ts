import { expect, it } from "vitest";
import { priceCart } from "./pricing";

it("prices a mug", () => expect(priceCart([{ sku: "mug", quantity: 2 }])).toBe(2400));
