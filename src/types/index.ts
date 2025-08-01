import { Request } from "express";

export interface User {
  id: string;
  mobile_number: string;
  password_hash?: string;
  subscription_tier: "basic" | "pro";
  stripe_customer_id?: string;
  created_at: Date;
  updated_at: Date;
}

export interface OTP {
  id: string;
  mobile_number: string;
  otp: string;
  purpose: "login" | "forgot_password";
  expires_at: Date;
  used: boolean;
  created_at: Date;
}

export interface Chatroom {
  id: string;
  user_id: string;
  title: string;
  created_at: Date;
  updated_at: Date;
}

export interface Message {
  id: string;
  chatroom_id: string;
  content: string;
  sender: "user" | "ai";
  created_at: Date;
}

export interface UsageTracking {
  id: string;
  user_id: string;
  date: string;
  message_count: number;
  created_at: Date;
}

export interface Subscription {
  id: string;
  user_id: string;
  stripe_subscription_id?: string;
  status: string;
  current_period_start?: Date;
  current_period_end?: Date;
  created_at: Date;
  updated_at: Date;
}

export interface AuthRequest extends Request {
  user?: User;
  currentUsage?: number;
  dailyLimit?: number;
}

export interface JWTPayload {
  userId: string;
  iat?: number;
  exp?: number;
}

export interface GeminiJobData {
  messageId: string;
  chatroomId: string;
  userId: string;
  userMessage: string;
}
