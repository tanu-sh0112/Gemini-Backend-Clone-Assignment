import { Job } from "bull";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { pool } from "../config/database";
import { GeminiJobData } from "../types";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

export default async function processGeminiJob(
  job: Job<GeminiJobData>
): Promise<void> {
  const { messageId, chatroomId, userMessage } = job.data;

  try {
    console.log(`Processing Gemini job for message ${messageId}`);

    // Get conversation history for context
    const historyResult = await pool.query(
      "SELECT content, sender FROM messages WHERE chatroom_id = $1 AND id != $2 ORDER BY created_at ASC LIMIT 10",
      [chatroomId, messageId]
    );

    // Build conversation context
    const conversationHistory = historyResult.rows
      .map(
        (row) =>
          `${row.sender === "user" ? "User" : "Assistant"}: ${row.content}`
      )
      .join("\n");

    // Get generative model
    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-pro",
    });

    // Create prompt with context
    const prompt = conversationHistory
      ? `Previous conversation:\n${conversationHistory}\n\nUser: ${userMessage}\n\nAssistant:`
      : `User: ${userMessage}\n\nAssistant:`;

    // Generate response
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const aiResponse = response.text();

    // Update the AI message with the generated response
    await pool.query("UPDATE messages SET content = $1 WHERE id = $2", [
      aiResponse,
      messageId,
    ]);

    // Update chatroom timestamp
    await pool.query(
      "UPDATE chatrooms SET updated_at = CURRENT_TIMESTAMP WHERE id = $1",
      [chatroomId]
    );

    console.log(`Gemini job completed for message ${messageId}`);
  } catch (error) {
    console.error("Gemini worker error:", error);

    // Update message with error response
    await pool.query("UPDATE messages SET content = $1 WHERE id = $2", [
      "Sorry, I encountered an error while processing your request. Please try again.",
      messageId,
    ]);

    throw error;
  }
}
