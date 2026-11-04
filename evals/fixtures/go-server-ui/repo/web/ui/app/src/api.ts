export interface QueryResult {
  value: number;
  true: boolean;
}

export interface Alert {
  name: string;
  expr: string;
  value: number;
  since: string;
}

/** Runs a query on the server. */
export async function runQuery(q: string): Promise<QueryResult> {
  const res = await fetch(`/api/query?q=${encodeURIComponent(q)}`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

/** The alerts that are firing. */
export async function firingAlerts(): Promise<Alert[]> {
  const res = await fetch("/api/alerts");
  return res.json();
}
