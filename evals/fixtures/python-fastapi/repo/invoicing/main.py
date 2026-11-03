from fastapi import FastAPI

from invoicing.api import customers, invoices

app = FastAPI()
app.include_router(invoices.router)
app.include_router(customers.router)
