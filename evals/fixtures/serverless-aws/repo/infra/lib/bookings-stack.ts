import { Duration, Stack, type StackProps } from "aws-cdk-lib";
import * as apigw from "aws-cdk-lib/aws-apigateway";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";
import * as iam from "aws-cdk-lib/aws-iam";
import { SqsEventSource } from "aws-cdk-lib/aws-lambda-event-sources";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as sqs from "aws-cdk-lib/aws-sqs";
import type { Construct } from "constructs";

export class BookingsStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const bookings = new dynamodb.Table(this, "BookingsTable", {
      tableName: "bookings",
      partitionKey: { name: "bookingId", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
    });
    bookings.addGlobalSecondaryIndex({
      indexName: "byCustomer",
      partitionKey: { name: "customerId", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "slot", type: dynamodb.AttributeType.STRING },
    });

    const reports = new dynamodb.Table(this, "ReportsTable", {
      tableName: "daily-reports",
      partitionKey: { name: "date", type: dynamodb.AttributeType.STRING },
    });

    const requested = new sqs.Queue(this, "BookingRequested", {
      queueName: "booking-requested",
      visibilityTimeout: Duration.seconds(60),
    });

    const site = new s3.Bucket(this, "WebSite", { websiteIndexDocument: "index.html" });

    const env = {
      BOOKINGS_TABLE: bookings.tableName,
      REPORTS_TABLE: reports.tableName,
      REQUESTED_QUEUE_URL: requested.queueUrl,
    };

    const createBooking = new NodejsFunction(this, "CreateBooking", {
      entry: "../services/bookings/src/handlers/create-booking.ts",
      environment: env,
    });
    const getBooking = new NodejsFunction(this, "GetBooking", {
      entry: "../services/bookings/src/handlers/get-booking.ts",
      environment: env,
    });
    const listBookings = new NodejsFunction(this, "ListBookings", {
      entry: "../services/bookings/src/handlers/list-bookings.ts",
      environment: env,
    });
    bookings.grantReadWriteData(createBooking);
    bookings.grantReadData(getBooking);
    bookings.grantReadData(listBookings);
    requested.grantSendMessages(createBooking);

    const api = new apigw.RestApi(this, "BookingsApi", { restApiName: "bookings" });
    const root = api.root.addResource("bookings");
    root.addMethod("POST", new apigw.LambdaIntegration(createBooking));
    root.addMethod("GET", new apigw.LambdaIntegration(listBookings));
    root.addResource("{bookingId}").addMethod("GET", new apigw.LambdaIntegration(getBooking));

    const confirm = new NodejsFunction(this, "ConfirmBooking", {
      entry: "../services/confirmations/src/confirm-booking.ts",
      environment: { ...env, FROM_ADDRESS: "bookings@example.com" },
    });
    confirm.addEventSource(new SqsEventSource(requested, { batchSize: 10 }));
    bookings.grantReadWriteData(confirm);
    confirm.addToRolePolicy(
      new iam.PolicyStatement({ actions: ["ses:SendEmail"], resources: ["*"] }),
    );

    const nightly = new NodejsFunction(this, "NightlyReport", {
      entry: "../services/reports/src/nightly-report.ts",
      environment: env,
    });
    bookings.grantReadData(nightly);
    reports.grantWriteData(nightly);
    new events.Rule(this, "Nightly", {
      schedule: events.Schedule.cron({ minute: "0", hour: "2" }),
      targets: [new targets.LambdaFunction(nightly)],
    });

    void site;
  }
}
