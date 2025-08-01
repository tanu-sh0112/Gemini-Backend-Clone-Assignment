import express, { Router, Request, Response } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { body, validationResult } from "express-validator";
import { pool } from "../config/database";
import { authenticateToken } from "../middleware/auth";
import { AuthRequest } from "../types";

const router: Router = express.Router();

// Generate OTP
function generateOTP(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// Create JWT token
function createToken(userId: string): string {
  return jwt.sign({ userId }, process.env.JWT_SECRET!, {});
}

router.post(
  "/signup",
  [
    body("mobile_number")
      .isMobilePhone("en-IN")
      .withMessage("Valid mobile number required"),
    body("password")
      .isLength({ min: 6 })
      .withMessage("Password must be at least 6 characters"),
  ],
  async (req: Request, res: Response): Promise<void> => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        res.status(400).json({ errors: errors.array() });
        return;
      }

      const { mobile_number, password } = req.body;

      // Check if user already exists
      const existingUser = await pool.query(
        "SELECT id FROM users WHERE mobile_number = $1",
        [mobile_number]
      );

      if (existingUser.rows.length > 0) {
        res.status(409).json({ error: "User already exists" });
        return;
      }

      // Hash password
      const passwordHash = await bcrypt.hash(password, 12);

      // Create user
      const result = await pool.query(
        "INSERT INTO users (mobile_number, password_hash) VALUES ($1, $2) RETURNING id, mobile_number, subscription_tier",
        [mobile_number, passwordHash]
      );

      const user = result.rows[0];
      const token = createToken(user.id);

      res.status(201).json({
        message: "User created successfully",
        user: {
          id: user.id,
          mobile_number: user.mobile_number,
          subscription_tier: user.subscription_tier,
        },
        token,
      });
    } catch (error) {
      console.error("Signup error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

// POST /auth/send-otp
router.post(
  "/send-otp",
  [
    body("mobile_number")
      .isMobilePhone("en-IN")
      .withMessage("Valid mobile number required"),
    body("purpose")
      .isIn(["login", "forgot_password"])
      .withMessage("Invalid purpose"),
  ],
  async (req: Request, res: Response): Promise<void> => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        res.status(400).json({ errors: errors.array() });
        return;
      }

      const { mobile_number, purpose } = req.body;
      const otp = generateOTP();
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

      // Delete previous unused OTPs
      await pool.query(
        "DELETE FROM otps WHERE mobile_number = $1 AND purpose = $2 AND used = FALSE",
        [mobile_number, purpose]
      );

      // Store new OTP
      await pool.query(
        "INSERT INTO otps (mobile_number, otp, purpose, expires_at) VALUES ($1, $2, $3, $4)",
        [mobile_number, otp, purpose, expiresAt]
      );

      res.json({
        message: "OTP sent successfully",
        otp: otp,
        expires_in: "10 minutes",
      });
    } catch (error) {
      console.error("Send OTP error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

// POST /auth/verify-otp
router.post(
  "/verify-otp",
  [
    body("mobile_number")
      .isMobilePhone("en-IN")
      .withMessage("Valid mobile number required"),
    body("otp")
      .isLength({ min: 6, max: 6 })
      .withMessage("OTP must be 6 digits"),
    body("purpose")
      .isIn(["login", "forgot_password"])
      .withMessage("Invalid purpose"),
  ],
  async (req: Request, res: Response): Promise<void> => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        res.status(400).json({ errors: errors.array() });
        return;
      }

      const { mobile_number, otp, purpose } = req.body;

      // Verify OTP
      const otpResult = await pool.query(
        "SELECT id FROM otps WHERE mobile_number = $1 AND otp = $2 AND purpose = $3 AND used = FALSE AND expires_at > NOW()",
        [mobile_number, otp, purpose]
      );

      if (otpResult.rows.length === 0) {
        res.status(400).json({ error: "Invalid or expired OTP" });
        return;
      }

      // Mark OTP as used
      await pool.query("UPDATE otps SET used = TRUE WHERE id = $1", [
        otpResult.rows[0].id,
      ]);

      // Get or create user for login
      if (purpose === "login") {
        let userResult = await pool.query(
          "SELECT id, mobile_number, subscription_tier FROM users WHERE mobile_number = $1",
          [mobile_number]
        );

        if (userResult.rows.length === 0) {
          // Create user if doesn't exist
          userResult = await pool.query(
            "INSERT INTO users (mobile_number) VALUES ($1) RETURNING id, mobile_number, subscription_tier",
            [mobile_number]
          );
        }

        const user = userResult.rows[0];
        const token = createToken(user.id);

        res.json({
          message: "OTP verified successfully",
          user: {
            id: user.id,
            mobile_number: user.mobile_number,
            subscription_tier: user.subscription_tier,
          },
          token,
        });
      } else {
        res.json({
          message: "OTP verified successfully",
          reset_token: jwt.sign(
            { mobile_number, purpose: "reset" },
            process.env.JWT_SECRET!,
            { expiresIn: "30m" }
          ),
        });
      }
    } catch (error) {
      console.error("Verify OTP error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

// POST /auth/forgot-password
router.post(
  "/forgot-password",
  [
    body("new_password")
      .isLength({ min: 6 })
      .withMessage("New password must be at least 6 characters"),
    body("mobile_number")
      .isMobilePhone("en-IN")
      .withMessage("Valid mobile number required"),
  ],
  async (req: Request, res: Response): Promise<void> => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        res.status(400).json({ errors: errors.array() });
        return;
      }

      const { mobile_number } = req.body;

      // Check if user exists
      const userResult = await pool.query(
        "SELECT id FROM users WHERE mobile_number = $1",
        [mobile_number]
      );

      if (userResult.rows.length === 0) {
        res.status(404).json({ error: "User not found" });
        return;
      }

      // Delete previous unused OTPs
      await pool.query(
        "DELETE FROM otps WHERE mobile_number = $1 AND purpose = $2 AND used = FALSE",
        [mobile_number, "forgot_password"]
      );

      //   generate hash for new password
      const newPasswordHash = await bcrypt.hash(req.body.new_password, 12);

      // Update user's password
      await pool.query(
        "UPDATE users SET password_hash = $1, updated_at = CURRENT_TIMESTAMP WHERE mobile_number = $2",
        [newPasswordHash, mobile_number]
      );

      res.json({ message: "Password updated successfully" });
    } catch (error) {
      console.error("Forgot password error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

// POST /auth/change-password
router.post(
  "/change-password",
  authenticateToken,
  [
    body("current_password")
      .notEmpty()
      .withMessage("Current password is required"),
    body("new_password")
      .isLength({ min: 6 })
      .withMessage("New password must be at least 6 characters"),
  ],
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        res.status(400).json({ errors: errors.array() });
        return;
      }

      const { current_password, new_password } = req.body;
      const userId = req.user!.id;

      // Get current password hash
      const userResult = await pool.query(
        "SELECT password_hash FROM users WHERE id = $1",
        [userId]
      );

      if (userResult.rows.length === 0) {
        res.status(404).json({ error: "User not found" });
        return;
      }

      const { password_hash } = userResult.rows[0];

      // Verify current password
      if (
        password_hash &&
        !(await bcrypt.compare(current_password, password_hash))
      ) {
        res.status(400).json({ error: "Current password is incorrect" });
        return;
      }

      // Hash new password
      const newPasswordHash = await bcrypt.hash(new_password, 12);

      // Update password
      await pool.query(
        "UPDATE users SET password_hash = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2",
        [newPasswordHash, userId]
      );

      res.json({ message: "Password changed successfully" });
    } catch (error) {
      console.error("Change password error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

export default router;
