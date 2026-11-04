import { check } from "k6";
import http from "k6/http";

export const options = { vus: 20, duration: "1m" };

export default function () {
  const res = http.post(
    `${__ENV.ORDERS_URL}/orders`,
    JSON.stringify({ email: "load@example.com", lines: [{ sku: "mug", quantity: 1 }] }),
    { headers: { "content-type": "application/json" } },
  );
  check(res, { created: (r) => r.status === 201 });
}
