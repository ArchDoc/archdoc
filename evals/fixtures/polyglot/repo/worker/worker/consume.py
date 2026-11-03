import pika

from worker.triage import triage


def main():
    conn = pika.BlockingConnection(pika.ConnectionParameters("rabbitmq"))
    ch = conn.channel()
    ch.basic_consume("ticket.opened", lambda _c, _m, _p, body: triage(body.decode()))
    ch.start_consuming()
