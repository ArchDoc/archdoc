export async function charge(orderId: string, cents: number): Promise<{ id: string }> {
  const res = await fetch("https://api.payments.example/charges", {
    method: "POST",
    body: JSON.stringify({ orderId, cents }),
  });
  return res.json();
}
