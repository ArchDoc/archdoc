import { Redis } from "ioredis";

export const cache = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379");
