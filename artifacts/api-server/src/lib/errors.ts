import type { Request, Response, NextFunction } from "express";
import { ZodError } from "zod";
import { isProduction } from "./env";

export type ErrorCode =
  | "validation_error"
  | "unauthorized"
  | "forbidden"
  | "payment_required"
  | "not_found"
  | "conflict"
  | "rate_limited"
  | "payload_too_large"
  | "internal_error";

export class HttpError extends Error {
  public readonly status: number;
  public readonly code: ErrorCode;
  public readonly details?: unknown;

  constructor(
    status: number,
    code: ErrorCode,
    message: string,
    details?: unknown,
  ) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const Errors = {
  badRequest: (message = "Bad request", details?: unknown) =>
    new HttpError(400, "validation_error", message, details),
  unauthorized: (message = "Unauthorized") =>
    new HttpError(401, "unauthorized", message),
  forbidden: (message = "Forbidden") =>
    new HttpError(403, "forbidden", message),
  paymentRequired: (message = "Payment required") =>
    new HttpError(402, "payment_required", message),
  notFound: (message = "Not found") =>
    new HttpError(404, "not_found", message),
  conflict: (message = "Conflict") => new HttpError(409, "conflict", message),
  rateLimited: (message = "Rate limit exceeded") =>
    new HttpError(429, "rate_limited", message),
  payloadTooLarge: (message = "Request payload too large") =>
    new HttpError(413, "payload_too_large", message),
};

export interface ErrorBody {
  error: string;
  code: ErrorCode;
  details?: unknown;
  requestId?: string;
}

/**
 * Central Express error handler. Must be registered LAST.
 * Production never leaks stack traces, internal IDs, or DB error text.
 */
export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction,
): void {
  // Express may invoke the handler after headers were partially flushed.
  // In that case, just close the connection — there's nothing safe to write.
  if (res.headersSent) {
    res.end();
    return;
  }

  const requestId =
    (req as { id?: string | number }).id !== undefined
      ? String((req as { id: string | number }).id)
      : undefined;

  // ZodError → 400 with field-level details
  if (err instanceof ZodError) {
    const body: ErrorBody = {
      error: "Validation failed",
      code: "validation_error",
      details: err.issues.map((i) => ({
        path: i.path.join("."),
        message: i.message,
      })),
      ...(requestId ? { requestId } : {}),
    };
    res.status(400).json(body);
    return;
  }

  // Body-parser size error
  if (
    err &&
    typeof err === "object" &&
    "type" in err &&
    (err as { type?: string }).type === "entity.too.large"
  ) {
    const body: ErrorBody = {
      error: "Request payload too large",
      code: "payload_too_large",
      ...(requestId ? { requestId } : {}),
    };
    res.status(413).json(body);
    return;
  }

  if (err instanceof HttpError) {
    const body: ErrorBody = {
      error: err.message,
      code: err.code,
      ...(err.details !== undefined ? { details: err.details } : {}),
      ...(requestId ? { requestId } : {}),
    };
    res.status(err.status).json(body);
    return;
  }

  // Unknown error → log full detail server-side, return generic to client
  req.log?.error({ err }, "Unhandled error in request");

  const body: ErrorBody = {
    error: isProduction
      ? "Internal server error"
      : err instanceof Error
        ? err.message
        : "Internal server error",
    code: "internal_error",
    ...(requestId ? { requestId } : {}),
    ...(isProduction || !(err instanceof Error)
      ? {}
      : { details: { stack: err.stack?.split("\n").slice(0, 6) } }),
  };
  res.status(500).json(body);
}

/**
 * Catches sync throws and unhandled promise rejections in async route
 * handlers so they reach the central error handler.
 */
export function asyncHandler<
  T extends (req: Request, res: Response, next: NextFunction) => unknown,
>(fn: T) {
  return (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
