"""Publishes order.shipped."""
import json
import os

import pika


def publish_shipped(order_id: str, email: str, tracking: str) -> None:
    conn = pika.BlockingConnection(pika.URLParameters(os.environ["AMQP_URL"]))
    body = json.dumps({"orderId": order_id, "email": email, "tracking": tracking})
    conn.channel().basic_publish("orders", "orders.shipped", body)
