import { pool } from "./pool";

export interface Order {
  id: string;
  email: string;
  total: number;
  status: string;
}

export async function insertOrder(o: Omit<Order, "id"> & { lines: unknown[] }): Promise<Order> {
  const r = await pool.query(
    "insert into orders (email, lines, total, status) values ($1, $2, $3, $4) returning *",
    [o.email, JSON.stringify(o.lines), o.total, o.status],
  );
  return r.rows[0];
}

export async function findOrder(id: string): Promise<Order | undefined> {
  const r = await pool.query("select * from orders where id = $1", [id]);
  return r.rows[0];
}
