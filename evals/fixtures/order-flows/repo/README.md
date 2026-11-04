# Order flows

A small shop split into services that talk over HTTP and RabbitMQ.

- **web**: the storefront. Customers check out and follow their order's status.
- **orders**: the orders API. Prices the cart, saves the order in Postgres, and
  publishes `order.placed`.
- **fulfillment**: picks and ships each placed order. Books a label with the
  carrier's API and publishes `order.shipped`.
- **notifier**: emails the customer when their order ships.
- **reports**: a nightly job (a Kubernetes CronJob) that emails finance the day's sales.

`e2e/`, `verification/`, and `loadtest/` hold the end-to-end tests, the
post-deploy smoke checks, and the load test.
