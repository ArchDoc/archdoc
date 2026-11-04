import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import type { SQSEvent } from "aws-lambda";
import { sendConfirmation } from "./mailer";

const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));

export async function handler(event: SQSEvent): Promise<void> {
  for (const record of event.Records) {
    const { bookingId, email, slot } = JSON.parse(record.body);
    await db.send(
      new UpdateCommand({
        TableName: process.env.BOOKINGS_TABLE,
        Key: { bookingId },
        UpdateExpression: "SET #s = :confirmed",
        ExpressionAttributeNames: { "#s": "status" },
        ExpressionAttributeValues: { ":confirmed": "confirmed" },
      }),
    );
    await sendConfirmation(email, slot);
  }
}
