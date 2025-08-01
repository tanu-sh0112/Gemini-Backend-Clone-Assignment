import { Request, Response, NextFunction } from "express";

interface CustomError extends Error {
  code?: string;
  details?: any;
}

export default function errorHandler(
  error: CustomError,
  req: Request,
  res: Response,
  next: NextFunction
): void {
  console.error("Error:", error);

  if (error.name === "ValidationError") {
    res.status(400).json({
      error: "Validation failed",
      details: error.details,
    });
    return;
  }

  if (error.code === "23505") {
    // PostgreSQL unique violation
    res.status(409).json({
      error: "Resource already exists",
    });
    return;
  }

  res.status(500).json({
    error: "Internal server error",
    ...(process.env.NODE_ENV === "development" && { details: error.message }),
  });
}
