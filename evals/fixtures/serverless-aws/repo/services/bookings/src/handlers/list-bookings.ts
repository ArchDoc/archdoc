import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { bookingsFor } from "../store/bookings-table";

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const customerId = event.requestContext.authorizer?.claims?.sub;
  return { statusCode: 200, body: JSON.stringify(await bookingsFor(customerId)) };
}
