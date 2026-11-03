import type { Order, Product } from "@shop/shared";
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

export const db = {
  async insertOrder(items: string[]): Promise<Order> {
    const r = await pool.query("insert into orders (items) values ($1) returning *", [items]);
    return r.rows[0];
  },
  async recordCharge(orderId: string, cents: number) {
    await pool.query("insert into charges (order_id, cents) values ($1, $2)", [orderId, cents]);
  },
  async product(id: string): Promise<Product> {
    return (await pool.query("select * from products where id = $1", [id])).rows[0];
  },
};
