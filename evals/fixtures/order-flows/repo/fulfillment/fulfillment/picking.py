"""Turns order lines into a parcel to ship."""

WEIGHTS = {"mug": 350, "tee": 200}


def pick(lines: list[dict]) -> dict:
    grams = sum(WEIGHTS.get(l["sku"], 500) * l["quantity"] for l in lines)
    return {"grams": grams, "items": len(lines)}
