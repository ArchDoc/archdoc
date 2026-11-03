import type { Product } from "@shop/shared";
import { cache } from "../storage/cache.js";
import { db } from "../storage/db.js";

export async function findProduct(id: string): Promise<Product> {
  const hit = await cache.get(`product:${id}`);
  if (hit) return JSON.parse(hit);
  return db.product(id);
}
