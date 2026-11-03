import express from "express";
import { orderRoutes } from "./routes/orders.js";
import { productRoutes } from "./routes/products.js";

const app = express();
app.use("/api/orders", orderRoutes);
app.use("/api/products", productRoutes);
app.listen(3000);
