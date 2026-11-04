locals {
  env = {
    BOOKINGS_TABLE      = aws_dynamodb_table.bookings.name
    REPORTS_TABLE       = aws_dynamodb_table.daily_reports.name
    REQUESTED_QUEUE_URL = aws_sqs_queue.booking_requested.url
  }
}

data "archive_file" "bookings" {
  type        = "zip"
  source_dir  = "${path.module}/../services/bookings/dist"
  output_path = "${path.module}/build/bookings.zip"
}

data "archive_file" "confirmations" {
  type        = "zip"
  source_dir  = "${path.module}/../services/confirmations/dist"
  output_path = "${path.module}/build/confirmations.zip"
}

data "archive_file" "reports" {
  type        = "zip"
  source_dir  = "${path.module}/../services/reports/dist"
  output_path = "${path.module}/build/reports.zip"
}

resource "aws_lambda_function" "create_booking" {
  function_name = "create-booking"
  filename      = data.archive_file.bookings.output_path
  handler       = "handlers/create-booking.handler"
  runtime       = "nodejs20.x"
  role          = aws_iam_role.bookings_api.arn
  environment { variables = local.env }
}

resource "aws_lambda_function" "get_booking" {
  function_name = "get-booking"
  filename      = data.archive_file.bookings.output_path
  handler       = "handlers/get-booking.handler"
  runtime       = "nodejs20.x"
  role          = aws_iam_role.bookings_api.arn
  environment { variables = local.env }
}

resource "aws_lambda_function" "list_bookings" {
  function_name = "list-bookings"
  filename      = data.archive_file.bookings.output_path
  handler       = "handlers/list-bookings.handler"
  runtime       = "nodejs20.x"
  role          = aws_iam_role.bookings_api.arn
  environment { variables = local.env }
}

resource "aws_lambda_function" "confirm_booking" {
  function_name = "confirm-booking"
  filename      = data.archive_file.confirmations.output_path
  handler       = "confirm-booking.handler"
  runtime       = "nodejs20.x"
  role          = aws_iam_role.confirmations.arn
  environment {
    variables = merge(local.env, { FROM_ADDRESS = "bookings@example.com" })
  }
}

resource "aws_lambda_event_source_mapping" "confirm_from_queue" {
  event_source_arn = aws_sqs_queue.booking_requested.arn
  function_name    = aws_lambda_function.confirm_booking.arn
  batch_size       = 10
}

resource "aws_lambda_function" "nightly_report" {
  function_name = "nightly-report"
  filename      = data.archive_file.reports.output_path
  handler       = "nightly-report.handler"
  runtime       = "nodejs20.x"
  role          = aws_iam_role.reports.arn
  environment { variables = local.env }
}

resource "aws_cloudwatch_event_rule" "nightly" {
  name                = "nightly-report"
  schedule_expression = "cron(0 2 * * ? *)"
}

resource "aws_cloudwatch_event_target" "nightly" {
  rule = aws_cloudwatch_event_rule.nightly.name
  arn  = aws_lambda_function.nightly_report.arn
}
