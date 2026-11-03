import { db } from "../storage/db.js";

export async function charge(orderId: string, cents: number): Promise<void> {
  await db.recordCharge(orderId, cents);
}
