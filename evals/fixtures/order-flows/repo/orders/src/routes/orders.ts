import { Router } from "express";
import { placeOrder } from "../checkout/place-order";
import { findOrder } from "../store/orders-repo";

export const ordersRouter = Router();

ordersRouter.post("/", async (req, res) => {
  const order = await placeOrder(req.body.email, req.body.lines);
  res.status(201).json(order);
});

ordersRouter.get("/:id", async (req, res) => {
  const order = await findOrder(req.params.id);
  if (!order) return res.sendStatus(404);
  res.json(order);
});
