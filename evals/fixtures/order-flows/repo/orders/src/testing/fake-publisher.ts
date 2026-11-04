export const published: unknown[] = [];
export async function publishOrderPlaced(event: unknown) {
  published.push(event);
}
