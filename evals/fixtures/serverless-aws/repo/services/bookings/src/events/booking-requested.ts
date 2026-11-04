import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import type { Booking } from "../store/bookings-table";

const sqs = new SQSClient({});

export interface BookingRequested {
  bookingId: string;
  email: string;
  slot: string;
}

export async function announce(booking: Booking): Promise<void> {
  const message: BookingRequested = {
    bookingId: booking.bookingId,
    email: booking.email,
    slot: booking.slot,
  };
  await sqs.send(
    new SendMessageCommand({
      QueueUrl: process.env.REQUESTED_QUEUE_URL,
      MessageBody: JSON.stringify(message),
    }),
  );
}
