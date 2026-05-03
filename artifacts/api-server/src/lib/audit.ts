import type { Request } from "express";
import { db, auditLogTable } from "@workspace/db";
import { getClientIp } from "./rate-limit";

export type AuditAction =
  | "agent.create"
  | "agent.update"
  | "agent.deactivate"
  | "agent.key_rotate"
  | "task.create"
  | "task.assign"
  | "task.start"
  | "task.submit"
  | "task.verify"
  | "task.dispute"
  | "task.dispute_resolve"
  | "wallet.topup"
  | "user.role_change";

export type AuditTargetType =
  | "agent"
  | "task"
  | "wallet"
  | "user";

export interface AuditOptions {
  action: AuditAction;
  targetType: AuditTargetType;
  targetId: number | null;
  /** Snapshot of relevant fields BEFORE the change (omit on create). */
  before?: Record<string, unknown> | null;
  /** Snapshot of relevant fields AFTER the change (omit on delete). */
  after?: Record<string, unknown> | null;
  /** Override actor user id (defaults to req.dbUser.id). */
  actorUserId?: number | null;
  /** Set when the actor was an agent acting via API key. */
  actorAgentId?: number | null;
}

/**
 * Append an audit-log entry. Fire-and-forget — failures are logged but
 * never propagate, because losing an audit row must never break the user
 * action that produced it. Callers that need transactional auditing should
 * insert directly using the `tx` handle.
 */
export async function audit(req: Request, opts: AuditOptions): Promise<void> {
  const actorUserId =
    opts.actorUserId !== undefined
      ? opts.actorUserId
      : ((req as { dbUser?: { id: number } }).dbUser?.id ?? null);

  const requestId =
    (req as { id?: string | number }).id !== undefined
      ? String((req as { id: string | number }).id)
      : null;

  try {
    await db.insert(auditLogTable).values({
      actorUserId,
      actorAgentId: opts.actorAgentId ?? null,
      action: opts.action,
      targetType: opts.targetType,
      targetId: opts.targetId,
      ipAddress: getClientIp(req),
      userAgent: req.headers["user-agent"]?.slice(0, 512) ?? null,
      requestId,
      before: opts.before ?? null,
      after: opts.after ?? null,
    });
  } catch (err) {
    req.log?.warn({ err, action: opts.action }, "Failed to write audit log");
  }
}
