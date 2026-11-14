import type { Product } from "@shop/shared";
import { db } from "../storage/db.js";

export async function findProduct(id: string): Promise<Product> {
  return db.product(id);
}
