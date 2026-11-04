import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";

export interface Booking {
  bookingId: string;
  customerId: string;
  email: string;
  restaurant: string;
  slot: string;
  partySize: number;
  status: "requested" | "confirmed";
}

const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TableName = process.env.BOOKINGS_TABLE;

export async function putBooking(booking: Booking): Promise<void> {
  await db.send(new PutCommand({ TableName, Item: booking }));
}

export async function getBooking(bookingId: string): Promise<Booking | undefined> {
  const out = await db.send(new GetCommand({ TableName, Key: { bookingId } }));
  return out.Item as Booking | undefined;
}

export async function bookingsFor(customerId: string): Promise<Booking[]> {
  const out = await db.send(
    new QueryCommand({
      TableName,
      IndexName: "byCustomer",
      KeyConditionExpression: "customerId = :c",
      ExpressionAttributeValues: { ":c": customerId },
    }),
  );
  return (out.Items ?? []) as Booking[];
}
