import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { getBooking } from "../store/bookings-table";

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const booking = await getBooking(event.pathParameters?.bookingId ?? "");
  if (!booking) return { statusCode: 404, body: "" };
  return { statusCode: 200, body: JSON.stringify(booking) };
}
