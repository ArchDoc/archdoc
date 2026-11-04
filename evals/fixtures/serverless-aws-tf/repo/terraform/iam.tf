data "aws_iam_policy_document" "lambda_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "bookings_api" {
  name               = "bookings-api"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

resource "aws_iam_role_policy" "bookings_api" {
  role = aws_iam_role.bookings_api.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      { Effect = "Allow", Action = ["dynamodb:PutItem", "dynamodb:GetItem", "dynamodb:Query"], Resource = [aws_dynamodb_table.bookings.arn, "${aws_dynamodb_table.bookings.arn}/index/*"] },
      { Effect = "Allow", Action = ["sqs:SendMessage"], Resource = aws_sqs_queue.booking_requested.arn },
    ]
  })
}

resource "aws_iam_role" "confirmations" {
  name               = "confirmations"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

resource "aws_iam_role_policy" "confirmations" {
  role = aws_iam_role.confirmations.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      { Effect = "Allow", Action = ["dynamodb:UpdateItem"], Resource = aws_dynamodb_table.bookings.arn },
      { Effect = "Allow", Action = ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes"], Resource = aws_sqs_queue.booking_requested.arn },
      { Effect = "Allow", Action = ["ses:SendEmail"], Resource = "*" },
    ]
  })
}

resource "aws_iam_role" "reports" {
  name               = "reports"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

resource "aws_iam_role_policy" "reports" {
  role = aws_iam_role.reports.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      { Effect = "Allow", Action = ["dynamodb:Scan"], Resource = aws_dynamodb_table.bookings.arn },
      { Effect = "Allow", Action = ["dynamodb:PutItem"], Resource = aws_dynamodb_table.daily_reports.arn },
    ]
  })
}
