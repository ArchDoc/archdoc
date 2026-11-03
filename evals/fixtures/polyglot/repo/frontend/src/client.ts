export async function listTickets(): Promise<unknown[]> {
  return (await fetch("/api/tickets")).json();
}
