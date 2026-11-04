"""Checks that order.placed events still carry the fields fulfillment reads."""
import json
import sys

REQUIRED = {"orderId", "email", "lines"}


def main(path: str) -> int:
    event = json.load(open(path))
    missing = REQUIRED - event.keys()
    print("missing:", sorted(missing)) if missing else print("ok")
    return 1 if missing else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1]))
