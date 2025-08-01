import express, { Router, Request, Response } from "express";
import Stripe from "stripe";
import { pool } from "../config/database";

const router: Router = express.Router();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2023-08-16",
});

// POST /webhook/stripe
router.post("/", async (req: Request, res: Response): Promise<void> => {
  const sig = req.headers["stripe-signature"] as string;
  let event: Stripe.Event;

  console.log("Webhook received");
  console.log("Body type:", typeof req.body);
  console.log("Body is Buffer:", Buffer.isBuffer(req.body));
  console.log("Signature present:", !!sig);
  console.log("Webhook secret present:", !!process.env.STRIPE_WEBHOOK_SECRET);

  if (!sig) {
    console.error("No stripe signature found in headers");
    res.status(400).send("No stripe signature");
    return;
  }

  console.log("Stripe signature123:");

  if (!process.env.STRIPE_WEBHOOK_SECRET) {
    console.error("STRIPE_WEBHOOK_SECRET not set in environment");
    res.status(500).send("Webhook secret not configured");
    return;
  }

  console.log("Webhook secret:2345");

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );

    console.log("Webhook verified successfully");
    console.log("Event type:", event.type);
    console.log("Event ID:", event.id);
  } catch (err: any) {
    console.error("Webhook signature verification failed:", err.message);
    console.error("Raw body length:", req.body?.length);
    console.error("Signature:", sig?.substring(0, 50) + "...");
    res.status(400).send(`Webhook Error: ${err.message}`);
    return;
  }

  try {
    switch (event.type) {
      case "checkout.session.completed":
        console.log("Processing checkout.session.completed");
        await handleCheckoutCompleted(
          event.data.object as Stripe.Checkout.Session
        );
        break;

      case "customer.subscription.created":
      case "customer.subscription.updated":
        console.log("Processing subscription created/updated");
        await handleSubscriptionUpdated(
          event.data.object as Stripe.Subscription
        );
        break;

      case "customer.subscription.deleted":
        console.log("Processing subscription deleted");
        await handleSubscriptionDeleted(
          event.data.object as Stripe.Subscription
        );
        break;

      case "invoice.payment_succeeded":
        console.log("Processing payment succeeded");
        await handlePaymentSucceeded(event.data.object as Stripe.Invoice);
        break;

      case "invoice.payment_failed":
        console.log("Processing payment failed");
        await handlePaymentFailed(event.data.object as Stripe.Invoice);
        break;

      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    console.log("Webhook processed successfully");
    res.json({ received: true, event_type: event.type });
  } catch (error) {
    console.error("Webhook handler error:", error);
    res.status(500).json({ error: "Webhook handler failed" });
  }
});

async function handleCheckoutCompleted(
  session: Stripe.Checkout.Session
): Promise<void> {
  const userId = session.metadata?.user_id;
  console.log("Checkout completed for user:", userId);
  console.log("Session ID:", session.id);
  console.log("Subscription ID:", session.subscription);

  if (!userId) {
    console.error("No user_id found in session metadata");
    return;
  }

  if (!session.subscription) {
    console.error("No subscription found in completed session");
    return;
  }

  // Get the subscription details
  const subscription = await stripe.subscriptions.retrieve(
    session.subscription as string
  );
  console.log(
    "Retrieved subscription:",
    subscription.id,
    "Status:",
    subscription.status
  );

  await upsertSubscription(userId, subscription);

  // Update user tier
  await pool.query(
    "UPDATE users SET subscription_tier = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2",
    ["pro", userId]
  );

  console.log("User upgraded to pro:", userId);
}

async function handleSubscriptionUpdated(
  subscription: Stripe.Subscription
): Promise<void> {
  console.log(
    "Subscription updated:",
    subscription.id,
    "Status:",
    subscription.status
  );

  let userId = subscription.metadata?.user_id;

  if (!userId) {
    // Try to find user by customer ID
    const customerResult = await pool.query(
      "SELECT id FROM users WHERE stripe_customer_id = $1",
      [subscription.customer]
    );

    if (customerResult.rows.length === 0) {
      console.error("No user found for customer:", subscription.customer);
      return;
    }

    userId = customerResult.rows[0].id;
    console.log("Found user by customer ID:", userId);
  }

  await upsertSubscription(userId, subscription);

  // Update user tier based on subscription status
  const tier = ["active", "trialing"].includes(subscription.status)
    ? "pro"
    : "basic";
  await pool.query(
    "UPDATE users SET subscription_tier = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2",
    [tier, userId]
  );

  console.log("User tier updated to:", tier, "for user:", userId);
}

async function handleSubscriptionDeleted(
  subscription: Stripe.Subscription
): Promise<void> {
  console.log("Subscription deleted:", subscription.id);

  // Update subscription status
  await pool.query(
    "UPDATE subscriptions SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE stripe_subscription_id = $2",
    ["canceled", subscription.id]
  );

  // Update user tier to basic
  const customerResult = await pool.query(
    "SELECT id FROM users WHERE stripe_customer_id = $1",
    [subscription.customer]
  );

  if (customerResult.rows.length > 0) {
    const userId = customerResult.rows[0].id;
    await pool.query(
      "UPDATE users SET subscription_tier = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2",
      ["basic", userId]
    );
    console.log("User downgraded to basic:", userId);
  }
}

async function handlePaymentSucceeded(invoice: Stripe.Invoice): Promise<void> {
  console.log("Payment succeeded for invoice:", invoice.id);
  // Additional logic for successful payments can be added here
}

async function handlePaymentFailed(invoice: Stripe.Invoice): Promise<void> {
  console.log("Payment failed for invoice:", invoice.id);
  // Additional logic for failed payments can be added here
}

async function upsertSubscription(
  userId: string,
  subscription: Stripe.Subscription
): Promise<void> {
  const currentPeriodStart = new Date(subscription.current_period_start * 1000);
  const currentPeriodEnd = new Date(subscription.current_period_end * 1000);

  console.log("Upserting subscription for user:", userId);
  console.log("Subscription details:", {
    id: subscription.id,
    status: subscription.status,
    current_period_start: currentPeriodStart,
    current_period_end: currentPeriodEnd,
  });

  await pool.query(
    `
    INSERT INTO subscriptions (user_id, stripe_subscription_id, status, current_period_start, current_period_end)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (user_id)
    DO UPDATE SET
      stripe_subscription_id = EXCLUDED.stripe_subscription_id,
      status = EXCLUDED.status,
      current_period_start = EXCLUDED.current_period_start,
      current_period_end = EXCLUDED.current_period_end,
      updated_at = CURRENT_TIMESTAMP
  `,
    [
      userId,
      subscription.id,
      subscription.status,
      currentPeriodStart,
      currentPeriodEnd,
    ]
  );

  console.log("Subscription upserted successfully");
}

export default router;
