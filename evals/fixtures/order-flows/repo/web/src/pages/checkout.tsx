import { placeOrder } from "../api";

export function Checkout() {
  const submit = async (email: string) => {
    const order = await placeOrder(email, [{ sku: "mug", quantity: 1 }]);
    location.assign(`/orders/${order.id}`);
  };
  return { submit };
}
