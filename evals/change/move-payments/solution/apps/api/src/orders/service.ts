import { charge } from "@shop/billing";
import type { Order } from "@shop/shared";
import { db } from "../storage/db.js";

export async function createOrder(items: string[]): Promise<Order> {
  const order = await db.insertOrder(items);
  const paid = await charge(order.id, order.totalCents);
  await db.recordCharge(order.id, paid.id);
  return order;
}
