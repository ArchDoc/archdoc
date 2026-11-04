/** The old UI's client: it only runs queries. */
export async function query(q: string): Promise<number> {
  const res = await fetch(`/api/query?q=${encodeURIComponent(q)}`);
  const body = (await res.json()) as { value: number };
  return body.value;
}
