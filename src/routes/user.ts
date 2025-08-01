import express, { Router, Response } from "express";
import { pool } from "../config/database";
import { authenticateToken } from "../middleware/auth";
import { AuthRequest } from "../types";

const router: Router = express.Router();

// GET /user/me
router.get(
  "/me",
  authenticateToken,
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const userId = req.user!.id;

      const result = await pool.query(
        `
      SELECT 
        u.id,
        u.mobile_number,
        u.subscription_tier,
        u.created_at,
        s.status as subscription_status,
        s.current_period_end
      FROM users u
      LEFT JOIN subscriptions s ON u.id = s.user_id AND s.status IN ('active', 'trialing')
      WHERE u.id = $1
    `,
        [userId]
      );

      if (result.rows.length === 0) {
        res.status(404).json({ error: "User not found" });
        return;
      }

      const user = result.rows[0];

      // Get today's usage
      const today = new Date().toISOString().split("T")[0];
      const usageResult = await pool.query(
        "SELECT message_count FROM usage_tracking WHERE user_id = $1 AND date = $2",
        [userId, today]
      );

      const todayUsage =
        usageResult.rows.length > 0 ? usageResult.rows[0].message_count : 0;
      const dailyLimit =
        user.subscription_tier === "pro"
          ? parseInt(process.env.PRO_DAILY_LIMIT!)
          : parseInt(process.env.BASIC_DAILY_LIMIT!);

      res.json({
        user: {
          id: user.id,
          mobile_number: user.mobile_number,
          subscription_tier: user.subscription_tier,
          subscription_status: user.subscription_status,
          subscription_expires: user.current_period_end,
          created_at: user.created_at,
        },
        usage: {
          today: todayUsage,
          daily_limit: dailyLimit,
          remaining: Math.max(0, dailyLimit - todayUsage),
        },
      });
    } catch (error) {
      console.error("Get user error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

export default router;
