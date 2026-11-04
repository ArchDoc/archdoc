import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";

const ses = new SESClient({});

export async function sendConfirmation(email: string, slot: string): Promise<void> {
  await ses.send(
    new SendEmailCommand({
      Source: process.env.FROM_ADDRESS,
      Destination: { ToAddresses: [email] },
      Message: {
        Subject: { Data: "Your table is booked" },
        Body: { Text: { Data: `See you at ${slot}.` } },
      },
    }),
  );
}
