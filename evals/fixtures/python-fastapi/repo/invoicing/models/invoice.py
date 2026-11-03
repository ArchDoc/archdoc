from sqlalchemy.orm import Mapped, mapped_column

from invoicing.models.base import Base


class Invoice(Base):
    __tablename__ = "invoices"
    id: Mapped[int] = mapped_column(primary_key=True)
    customer_id: Mapped[str]
    cents: Mapped[int]
