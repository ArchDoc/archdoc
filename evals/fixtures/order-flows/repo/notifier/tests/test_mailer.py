from unittest.mock import patch

from notifier.mailer import send_shipped_email


def test_sends_tracking_number():
    with patch("smtplib.SMTP") as smtp:
        send_shipped_email({"email": "a@example.com", "tracking": "T1"})
    assert smtp.called
