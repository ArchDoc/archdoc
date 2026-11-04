import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";

const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));

export async function handler(): Promise<void> {
  const date = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const out = await db.send(
    new ScanCommand({
      TableName: process.env.BOOKINGS_TABLE,
      FilterExpression: "begins_with(slot, :d)",
      ExpressionAttributeValues: { ":d": date },
    }),
  );
  const items = out.Items ?? [];
  const covers = items.reduce((n, b) => n + (b.partySize as number), 0);
  await db.send(
    new PutCommand({
      TableName: process.env.REPORTS_TABLE,
      Item: { date, bookings: items.length, covers },
    }),
  );
}
