from invoicing.db import session
from invoicing.models.invoice import Invoice


def issue(customer_id: str, cents: int) -> Invoice:
    invoice = Invoice(customer_id=customer_id, cents=cents)
    with session() as s:
        s.add(invoice)
    return invoice
