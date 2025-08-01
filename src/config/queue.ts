import Queue from "bull";
import { GeminiJobData } from "../types";

let geminiQueue: Queue.Queue<GeminiJobData>;

export async function initializeQueue(): Promise<void> {
  try {
    console.log("Initializing queue...", process.env.REDIS_URL);
    geminiQueue = new Queue<GeminiJobData>(
      "gemini processing",
      process.env.REDIS_URL!
    );

    // Process gemini API calls
    geminiQueue.process(
      "generateResponse",
      require("../routes/geminiWorker").default
    );

    console.log("Queue initialized successfully");
  } catch (error) {
    console.error("Queue initialization failed:", error);
    throw error;
  }
}

export function getGeminiQueue(): Queue.Queue<GeminiJobData> {
  return geminiQueue;
}
