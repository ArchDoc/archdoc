# Bookings

Customers book a table at a restaurant from the web app. The bookings API runs
on AWS Lambda behind API Gateway and keeps bookings in DynamoDB. Each new
booking goes on an SQS queue; the confirmations Lambda confirms it and emails
the customer through SES. Every night an EventBridge schedule runs the reports
Lambda, which totals the day's bookings into a reports table.

The stack is Terraform in `terraform/`, one workspace per environment
(`production`, `staging`): `terraform -chdir=terraform apply`.
