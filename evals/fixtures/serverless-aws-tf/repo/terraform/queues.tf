resource "aws_sqs_queue" "booking_requested" {
  name                       = "booking-requested"
  visibility_timeout_seconds = 60
}
