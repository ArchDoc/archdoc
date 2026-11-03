import { formatPrice } from "@shop/shared";

export function ProductPage(props: { name: string; cents: number }) {
  return (
    <h1>
      {props.name} {formatPrice(props.cents)}
    </h1>
  );
}
