"""Consumes order.shipped and emails the customer."""
import json
import os

import pika

from notifier.mailer import send_shipped_email


def main() -> None:
    conn = pika.BlockingConnection(pika.URLParameters(os.environ["AMQP_URL"]))
    ch = conn.channel()
    ch.queue_declare("notifier")
    ch.queue_bind("notifier", "orders", routing_key="order.shipped")
    ch.basic_consume(
        "notifier", lambda c, m, p, body: send_shipped_email(json.loads(body)), auto_ack=True
    )
    ch.start_consuming()
