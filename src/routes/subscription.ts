import express, { Router, Response } from "express";
import Stripe from "stripe";
import { pool } from "../config/database";
import { authenticateToken } from "../middleware/auth";
import { AuthRequest } from "../types";

const router: Router = express.Router();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2023-08-16",
});

// POST /subscribe/pro - Initiate Pro subscription
router.post(
  "/pro",
  authenticateToken,
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const userId = req.user!.id;
      const userMobile = req.user!.mobile_number;

      // Check if user already has active subscription
      const existingSubscription = await pool.query(
        "SELECT * FROM subscriptions WHERE user_id = $1 AND status IN ($2, $3)",
        [userId, "active", "trialing"]
      );

      if (existingSubscription.rows.length > 0) {
        res
          .status(400)
          .json({ error: "User already has an active subscription" });
        return;
      }

      // Get or create Stripe customer
      let stripeCustomerId: string | undefined;

      const userResult = await pool.query(
        "SELECT stripe_customer_id FROM users WHERE id = $1",
        [userId]
      );

      if (userResult.rows[0]?.stripe_customer_id) {
        stripeCustomerId = userResult.rows[0].stripe_customer_id;
      } else {
        const customer = await stripe.customers.create({
          phone: userMobile,
          metadata: { user_id: userId },
        });

        stripeCustomerId = customer.id;

        // Update user with customer ID
        await pool.query(
          "UPDATE users SET stripe_customer_id = $1 WHERE id = $2",
          [stripeCustomerId, userId]
        );
      }

      if (!stripeCustomerId) {
        res
          .status(500)
          .json({ error: "Stripe customer ID could not be determined" });
        return;
      }

      // Create checkout session
      const session = await stripe.checkout.sessions.create({
        customer: stripeCustomerId,
        payment_method_types: ["card"],
        line_items: [
          {
            price: process.env.STRIPE_PRO_PRICE_ID!,
            quantity: 1,
          },
        ],
        mode: "subscription",
        success_url: `${
          req.headers.origin || "http://localhost:3000"
        }/subscription/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${
          req.headers.origin || "http://localhost:3000"
        }/subscription/cancel`,
        metadata: {
          user_id: userId,
        },
      });

      res.json({
        message: "Checkout session created successfully",
        checkout_url: session.url,
        session_id: session.id,
      });
    } catch (error) {
      console.error("Create subscription error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

// GET /subscription/status - Get subscription status
router.get(
  "/status",
  authenticateToken,
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const userId = req.user!.id;

      const result = await pool.query(
        `
      SELECT 
        u.subscription_tier,
        s.status,
        s.current_period_start,
        s.current_period_end,
        s.stripe_subscription_id
      FROM users u
      LEFT JOIN subscriptions s ON u.id = s.user_id AND s.status IN ('active', 'trialing', 'past_due')
      WHERE u.id = $1
    `,
        [userId]
      );

      if (result.rows.length === 0) {
        res.status(404).json({ error: "User not found" });
        return;
      }

      const subscription = result.rows[0];

      // Get usage stats
      const today = new Date().toISOString().split("T")[0];
      const usageResult = await pool.query(
        "SELECT message_count FROM usage_tracking WHERE user_id = $1 AND date = $2",
        [userId, today]
      );

      const todayUsage =
        usageResult.rows.length > 0 ? usageResult.rows[0].message_count : 0;
      const dailyLimit =
        subscription.subscription_tier === "pro"
          ? parseInt(process.env.PRO_DAILY_LIMIT!)
          : parseInt(process.env.BASIC_DAILY_LIMIT!);

      res.json({
        subscription: {
          tier: subscription.subscription_tier,
          status: subscription.status || "inactive",
          current_period_start: subscription.current_period_start,
          current_period_end: subscription.current_period_end,
          stripe_subscription_id: subscription.stripe_subscription_id,
        },
        usage: {
          today: todayUsage,
          daily_limit: dailyLimit,
          remaining: Math.max(0, dailyLimit - todayUsage),
        },
      });
    } catch (error) {
      console.error("Get subscription status error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

export default router;
