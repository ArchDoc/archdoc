import { getOrder } from "../api";

export function OrderStatus({ id }: { id: string }) {
  return { load: () => getOrder(id) };
}
