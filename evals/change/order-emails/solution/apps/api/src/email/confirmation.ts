import type { Order } from "@shop/shared";

export async function sendConfirmation(order: Order): Promise<void> {
  await fetch("https://api.mail.example/send", {
    method: "POST",
    body: JSON.stringify({ template: "order-confirmation", orderId: order.id }),
  });
}
