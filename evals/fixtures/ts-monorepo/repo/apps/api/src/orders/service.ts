import type { Order } from "@shop/shared";
import { charge } from "../payments/charge.js";
import { db } from "../storage/db.js";

export async function createOrder(items: string[]): Promise<Order> {
  const order = await db.insertOrder(items);
  await charge(order.id, order.totalCents);
  return order;
}
