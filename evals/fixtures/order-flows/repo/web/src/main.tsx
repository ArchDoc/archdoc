import { Checkout } from "./pages/checkout";
import { OrderStatus } from "./pages/order-status";

export function App({ path }: { path: string }) {
  return path.startsWith("/orders/") ? OrderStatus({ id: path.slice(8) }) : Checkout();
}
