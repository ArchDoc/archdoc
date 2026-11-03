import type { Order, Product } from "@shop/shared";

const base = "/api";

export async function getProduct(id: string): Promise<Product> {
  return (await fetch(`${base}/products/${id}`)).json();
}

export async function placeOrder(items: string[]): Promise<Order> {
  const res = await fetch(`${base}/orders`, { method: "POST", body: JSON.stringify({ items }) });
  return res.json();
}
