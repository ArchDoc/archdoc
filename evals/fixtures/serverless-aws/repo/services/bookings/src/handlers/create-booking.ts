import { randomUUID } from "node:crypto";
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { announce } from "../events/booking-requested";
import { type Booking, putBooking } from "../store/bookings-table";

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const body = JSON.parse(event.body ?? "{}");
  if (!body.restaurant || !body.slot || !(body.partySize > 0)) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "restaurant, slot, and partySize are required" }),
    };
  }
  const booking: Booking = {
    bookingId: randomUUID(),
    customerId: event.requestContext.authorizer?.claims?.sub,
    email: event.requestContext.authorizer?.claims?.email,
    restaurant: body.restaurant,
    slot: body.slot,
    partySize: body.partySize,
    status: "requested",
  };
  await putBooking(booking);
  await announce(booking);
  return { statusCode: 201, body: JSON.stringify(booking) };
}
