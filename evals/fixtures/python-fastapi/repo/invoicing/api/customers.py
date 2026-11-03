from fastapi import APIRouter

from invoicing.services import customers

router = APIRouter(prefix="/customers")


@router.get("/{customer_id}")
def get(customer_id: str):
    return customers.find(customer_id)
