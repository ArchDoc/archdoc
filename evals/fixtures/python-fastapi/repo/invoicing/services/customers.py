from invoicing.db import session
from invoicing.models.customer import Customer


def find(customer_id: str) -> Customer | None:
    with session() as s:
        return s.get(Customer, customer_id)
