from sqlalchemy.orm import Mapped, mapped_column

from invoicing.models.base import Base


class Customer(Base):
    __tablename__ = "customers"
    id: Mapped[str] = mapped_column(primary_key=True)
    email: Mapped[str]
