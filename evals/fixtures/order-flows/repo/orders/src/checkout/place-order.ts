import { publishOrderPlaced } from "../events/publisher";
import { insertOrder } from "../store/orders-repo";
import { priceCart } from "./pricing";

export async function placeOrder(email: string, lines: { sku: string; quantity: number }[]) {
  const total = priceCart(lines);
  const order = await insertOrder({ email, lines, total, status: "placed" });
  await publishOrderPlaced({ orderId: order.id, email, lines });
  return order;
}
