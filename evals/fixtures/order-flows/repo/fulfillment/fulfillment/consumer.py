"""Consumes order.placed and ships each order."""
import json
import os

import pika

from fulfillment.carrier import book_label
from fulfillment.events import publish_shipped
from fulfillment.picking import pick


def handle(body: bytes) -> None:
    order = json.loads(body)
    parcel = pick(order["lines"])
    tracking = book_label(order["orderId"], parcel)
    publish_shipped(order["orderId"], order["email"], tracking)


def main() -> None:
    conn = pika.BlockingConnection(pika.URLParameters(os.environ["AMQP_URL"]))
    ch = conn.channel()
    ch.queue_declare("fulfillment")
    ch.queue_bind("fulfillment", "orders", routing_key="order.placed")
    ch.basic_consume("fulfillment", lambda c, m, p, body: handle(body), auto_ack=True)
    ch.start_consuming()
