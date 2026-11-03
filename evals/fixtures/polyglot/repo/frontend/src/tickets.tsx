import { listTickets } from "./client.js";

export function TicketList() {
  void listTickets();
  return <ul />;
}
