import express, { Router, Response } from "express";
import { body, validationResult } from "express-validator";
import { pool } from "../config/database";
import { getRedisClient } from "../config/redis";
import { getGeminiQueue } from "../config/queue";
import { authenticateToken } from "../middleware/auth";
import { checkDailyLimit, incrementUsage } from "../middleware/rateLimiting";
import { AuthRequest } from "../types";

const router: Router = express.Router();

// POST /chatroom - Create new chatroom
router.post(
  "/",
  authenticateToken,
  [
    body("title")
      .isLength({ min: 1, max: 255 })
      .withMessage("Title must be between 1 and 255 characters"),
  ],
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        res.status(400).json({ errors: errors.array() });
        return;
      }

      const { title } = req.body;
      const userId = req.user!.id;

      const result = await pool.query(
        "INSERT INTO chatrooms (user_id, title) VALUES ($1, $2) RETURNING *",
        [userId, title]
      );

      const chatroom = result.rows[0];

      // Invalidate cache
      const redis = getRedisClient();
      await redis.del(`chatrooms:${userId}`);

      res.status(201).json({
        message: "Chatroom created successfully",
        chatroom: {
          id: chatroom.id,
          title: chatroom.title,
          created_at: chatroom.created_at,
          updated_at: chatroom.updated_at,
        },
      });
    } catch (error) {
      console.error("Create chatroom error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

// GET /chatroom - List all chatrooms (with caching)
router.get(
  "/",
  authenticateToken,
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const userId = req.user!.id;
      const redis = getRedisClient();
      const cacheKey = `chatrooms:${userId}`;

      // Try to get from cache first
      const cached = await redis.get(cacheKey);
      if (cached) {
        res.json({
          chatrooms: JSON.parse(cached),
          cached: true,
        });
        return;
      }

      // Get from database
      const result = await pool.query(
        `
      SELECT 
        c.*,
        COUNT(m.id) as message_count,
        MAX(m.created_at) as last_message_at
      FROM chatrooms c
      LEFT JOIN messages m ON c.id = m.chatroom_id
      WHERE c.user_id = $1
      GROUP BY c.id
      ORDER BY c.updated_at DESC
    `,
        [userId]
      );

      const chatrooms = result.rows.map((row) => ({
        id: row.id,
        title: row.title,
        message_count: parseInt(row.message_count),
        last_message_at: row.last_message_at,
        created_at: row.created_at,
        updated_at: row.updated_at,
      }));

      // Cache for 5 minutes
      await redis.setEx(cacheKey, 300, JSON.stringify(chatrooms));

      res.json({
        chatrooms,
        cached: false,
      });
    } catch (error) {
      console.error("List chatrooms error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

// GET /chatroom/:id - Get specific chatroom with messages
router.get(
  "/:id",
  authenticateToken,
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const userId = req.user!.id;

      // Get chatroom
      const chatroomResult = await pool.query(
        "SELECT * FROM chatrooms WHERE id = $1 AND user_id = $2",
        [id, userId]
      );

      if (chatroomResult.rows.length === 0) {
        res.status(404).json({ error: "Chatroom not found" });
        return;
      }

      // Get messages
      const messagesResult = await pool.query(
        "SELECT * FROM messages WHERE chatroom_id = $1 ORDER BY created_at ASC",
        [id]
      );

      const chatroom = chatroomResult.rows[0];
      const messages = messagesResult.rows;

      res.json({
        chatroom: {
          id: chatroom.id,
          title: chatroom.title,
          created_at: chatroom.created_at,
          updated_at: chatroom.updated_at,
        },
        messages: messages.map((msg) => ({
          id: msg.id,
          content: msg.content,
          sender: msg.sender,
          created_at: msg.created_at,
        })),
      });
    } catch (error) {
      console.error("Get chatroom error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

// POST /chatroom/:id/message - Send message and get AI response
router.post(
  "/:id/message",
  authenticateToken,
  checkDailyLimit,
  [
    body("message")
      .isLength({ min: 1, max: 10000 })
      .withMessage("Message must be between 1 and 10000 characters"),
  ],
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        res.status(400).json({ errors: errors.array() });
        return;
      }

      const { id: chatroomId } = req.params;
      const { message } = req.body;
      const userId = req.user!.id;

      // Verify chatroom belongs to user
      const chatroomResult = await pool.query(
        "SELECT id FROM chatrooms WHERE id = $1 AND user_id = $2",
        [chatroomId, userId]
      );

      if (chatroomResult.rows.length === 0) {
        res.status(404).json({ error: "Chatroom not found" });
        return;
      }

      // Save user message
      const userMessageResult = await pool.query(
        "INSERT INTO messages (chatroom_id, content, sender) VALUES ($1, $2, $3) RETURNING *",
        [chatroomId, message, "user"]
      );

      const userMessage = userMessageResult.rows[0];

      // Create placeholder AI message
      const aiMessageResult = await pool.query(
        "INSERT INTO messages (chatroom_id, content, sender) VALUES ($1, $2, $3) RETURNING *",
        [chatroomId, "Thinking...", "ai"]
      );

      const aiMessage = aiMessageResult.rows[0];

      // Queue Gemini API call
      const queue = getGeminiQueue();
      await queue.add("generateResponse", {
        messageId: aiMessage.id,
        chatroomId,
        userId,
        userMessage: message,
      });

      console.log(
        `Queued Gemini job for message ${aiMessage.id} in chatroom ${chatroomId}`,
        queue
      );

      // Increment usage count
      await incrementUsage(userId);

      res.json({
        message: "Message sent successfully",
        user_message: {
          id: userMessage.id,
          content: userMessage.content,
          sender: userMessage.sender,
          created_at: userMessage.created_at,
        },
        ai_message: {
          id: aiMessage.id,
          content: aiMessage.content,
          sender: aiMessage.sender,
          created_at: aiMessage.created_at,
          status: "processing",
        },
      });
    } catch (error) {
      console.error("Send message error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

export default router;
