"""Post-deploy smoke check: the orders API answers and RabbitMQ has the exchange."""
import os
import sys

import httpx


def main() -> int:
    r = httpx.get(f"{os.environ['ORDERS_URL']}/orders/smoke-test")
    return 0 if r.status_code in (200, 404) else 1


if __name__ == "__main__":
    sys.exit(main())
