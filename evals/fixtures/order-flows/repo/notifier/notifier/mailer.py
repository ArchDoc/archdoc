"""Sends email through the SMTP relay."""
import os
import smtplib
from email.message import EmailMessage


def send_shipped_email(event: dict) -> None:
    msg = EmailMessage()
    msg["To"] = event["email"]
    msg["Subject"] = "Your order is on its way"
    msg.set_content(f"Tracking number: {event['tracking']}")
    with smtplib.SMTP(os.environ["SMTP_HOST"]) as smtp:
        smtp.send_message(msg)
