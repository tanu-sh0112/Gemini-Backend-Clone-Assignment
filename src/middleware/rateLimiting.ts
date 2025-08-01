import { Response, NextFunction } from "express";
import { pool } from "../config/database";
import { AuthRequest } from "../types";

export async function checkDailyLimit(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = req.user!.id;
    const subscriptionTier = req.user!.subscription_tier;
    const today = new Date().toISOString().split("T")[0];

    // Get or create usage tracking for today
    const upsertQuery = `
      INSERT INTO usage_tracking (user_id, date, message_count)
      VALUES ($1, $2, 0)
      ON CONFLICT (user_id, date)
      DO NOTHING
      RETURNING message_count;
    `;
    await pool.query(upsertQuery, [userId, today]);

    // Get current usage
    const usageResult = await pool.query(
      "SELECT message_count FROM usage_tracking WHERE user_id = $1 AND date = $2",
      [userId, today]
    );

    const currentUsage = usageResult.rows[0].message_count;
    const limit =
      subscriptionTier === "pro"
        ? parseInt(process.env.PRO_DAILY_LIMIT!)
        : parseInt(process.env.BASIC_DAILY_LIMIT!);

    if (currentUsage >= limit) {
      res.status(429).json({
        error: "Daily message limit exceeded",
        current_usage: currentUsage,
        limit: limit,
      });
      return;
    }

    req.currentUsage = currentUsage;
    req.dailyLimit = limit;
    next();
  } catch (error) {
    console.error("Rate limiting check failed:", error);
    res.status(500).json({ error: "Internal server error" });
  }
}

export async function incrementUsage(userId: string): Promise<void> {
  const today = new Date().toISOString().split("T")[0];
  await pool.query(
    "UPDATE usage_tracking SET message_count = message_count + 1 WHERE user_id = $1 AND date = $2",
    [userId, today]
  );
}
