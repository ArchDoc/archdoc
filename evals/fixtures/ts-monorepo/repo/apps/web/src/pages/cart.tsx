import { placeOrder } from "../api-client.js";

export function CartPage(props: { items: string[] }) {
  return (
    <button type="button" onClick={() => placeOrder(props.items)}>
      Check out
    </button>
  );
}
