import amqp from "amqplib";

export async function publishOrderPlaced(event: {
  orderId: string;
  email: string;
  lines: unknown[];
}) {
  const conn = await amqp.connect(process.env.AMQP_URL ?? "amqp://localhost");
  const ch = await conn.createChannel();
  await ch.assertExchange("orders", "topic");
  ch.publish("orders", "order.placed", Buffer.from(JSON.stringify(event)));
}
