import { createClient, RedisClientType } from "redis";

let client: RedisClientType;

export async function connectRedis(): Promise<void> {
  try {
    client = createClient({
      username: "default",
      password: process.env.REDIS_PASSWORD,
      socket: {
        host: process.env.REDIS_URL,
        port: 16587,
      },
    });

    client.on("error", (err) => console.error("Redis Client Error", err));

    await client.connect();
    console.log("Redis connected successfully");
  } catch (error) {
    console.error("Redis connection failed:", error);
    throw error;
  }
}

export function getRedisClient(): RedisClientType {
  return client;
}
