from fastapi import APIRouter

from invoicing.services import billing

router = APIRouter(prefix="/invoices")


@router.post("/")
def create(customer_id: str, cents: int):
    return billing.issue(customer_id, cents)
