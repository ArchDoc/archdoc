import { Router } from "express";
import { findProduct } from "../catalog/products.js";

export const productRoutes = Router().get("/:id", async (req, res) => {
  res.json(await findProduct(req.params.id));
});
