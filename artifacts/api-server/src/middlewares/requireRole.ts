import type { Request, Response, NextFunction } from "express";
import { Errors } from "../lib/errors";

export type Role = "user" | "admin" | "moderator";

/**
 * Gate a route to one of the listed roles. Must be mounted AFTER
 * `requireAuth` (relies on `req.dbUser`). Ownership checks should remain
 * in the route handler — this middleware is for org-wide admin/moderator
 * surfaces only.
 *
 * No admin endpoints exist yet; that work lands in the admin task. This
 * middleware is the seam those endpoints will consume.
 */
export function requireRole(...allowed: Role[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const user = (req as { dbUser?: { role?: string } }).dbUser;
    if (!user) {
      next(Errors.unauthorized());
      return;
    }
    const role = (user.role ?? "user") as Role;
    if (!allowed.includes(role)) {
      next(Errors.forbidden("Insufficient role"));
      return;
    }
    next();
  };
}
