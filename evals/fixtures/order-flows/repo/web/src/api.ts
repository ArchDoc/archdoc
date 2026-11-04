// The storefront reaches the orders API over HTTP; the URL comes from the environment.
const ORDERS_URL = import.meta.env.VITE_ORDERS_URL;

export interface CartLine {
  sku: string;
  quantity: number;
}

export async function placeOrder(email: string, lines: CartLine[]) {
  const res = await fetch(`${ORDERS_URL}/orders`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, lines }),
  });
  return (await res.json()) as { id: string; total: number };
}

export async function getOrder(id: string) {
  const res = await fetch(`${ORDERS_URL}/orders/${id}`);
  return (await res.json()) as { id: string; status: string };
}
