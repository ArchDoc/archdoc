"""The carrier's label API."""
import os

import httpx


def book_label(order_id: str, parcel: dict) -> str:
    r = httpx.post(f"{os.environ['CARRIER_API_URL']}/labels", json={"reference": order_id, **parcel})
    r.raise_for_status()
    return r.json()["tracking_number"]
