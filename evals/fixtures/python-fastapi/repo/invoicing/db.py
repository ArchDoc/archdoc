import os
from contextlib import contextmanager

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

engine = create_engine(os.environ.get("DATABASE_URL", "postgresql+psycopg://localhost/invoicing"))


@contextmanager
def session():
    with Session(engine) as s, s.begin():
        yield s
