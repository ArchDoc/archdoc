resource "aws_apigatewayv2_api" "bookings" {
  name          = "bookings"
  protocol_type = "HTTP"
}

resource "aws_apigatewayv2_integration" "create_booking" {
  api_id           = aws_apigatewayv2_api.bookings.id
  integration_type = "AWS_PROXY"
  integration_uri  = aws_lambda_function.create_booking.invoke_arn
}

resource "aws_apigatewayv2_integration" "get_booking" {
  api_id           = aws_apigatewayv2_api.bookings.id
  integration_type = "AWS_PROXY"
  integration_uri  = aws_lambda_function.get_booking.invoke_arn
}

resource "aws_apigatewayv2_integration" "list_bookings" {
  api_id           = aws_apigatewayv2_api.bookings.id
  integration_type = "AWS_PROXY"
  integration_uri  = aws_lambda_function.list_bookings.invoke_arn
}

resource "aws_apigatewayv2_route" "create_booking" {
  api_id    = aws_apigatewayv2_api.bookings.id
  route_key = "POST /bookings"
  target    = "integrations/${aws_apigatewayv2_integration.create_booking.id}"
}

resource "aws_apigatewayv2_route" "list_bookings" {
  api_id    = aws_apigatewayv2_api.bookings.id
  route_key = "GET /bookings"
  target    = "integrations/${aws_apigatewayv2_integration.list_bookings.id}"
}

resource "aws_apigatewayv2_route" "get_booking" {
  api_id    = aws_apigatewayv2_api.bookings.id
  route_key = "GET /bookings/{bookingId}"
  target    = "integrations/${aws_apigatewayv2_integration.get_booking.id}"
}
