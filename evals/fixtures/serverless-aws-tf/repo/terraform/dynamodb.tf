resource "aws_dynamodb_table" "bookings" {
  name         = "bookings"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "bookingId"

  attribute {
    name = "bookingId"
    type = "S"
  }
  attribute {
    name = "customerId"
    type = "S"
  }
  attribute {
    name = "slot"
    type = "S"
  }

  global_secondary_index {
    name            = "byCustomer"
    hash_key        = "customerId"
    range_key       = "slot"
    projection_type = "ALL"
  }
}

resource "aws_dynamodb_table" "daily_reports" {
  name         = "daily-reports"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "date"

  attribute {
    name = "date"
    type = "S"
  }
}
