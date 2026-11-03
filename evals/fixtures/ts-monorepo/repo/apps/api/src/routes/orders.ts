import { Router } from "express";
import { createOrder } from "../orders/service.js";

export const orderRoutes = Router().post("/", async (req, res) => {
  res.json(await createOrder(req.body.items));
});
