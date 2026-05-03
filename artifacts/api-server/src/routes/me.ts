import { Router, type IRouter } from "express";
import { requireAuth } from "../lib/auth";
import { GetMeResponse } from "@workspace/api-zod";
import { centsFromDb, centsToDollars } from "../lib/money";
import { authLimit, userBaselineLimit } from "../middlewares/rateLimits";

const router: IRouter = Router();

// /me is hit on every page load to bootstrap the session, so it gets both
// the strict per-IP `authLimit` (cheap defense against credential-spray
// floods) and the per-user baseline.
router.get(
  "/me",
  authLimit,
  requireAuth,
  userBaselineLimit,
  async (req, res): Promise<void> => {
    const u = req.dbUser!;
    res.json(
      GetMeResponse.parse({
        id: u.id,
        clerkUserId: u.clerkUserId,
        email: u.email,
        displayName: u.displayName,
        avatarUrl: u.avatarUrl,
        // Posting balance is stored as integer cents; the public API
        // still emits decimal dollars to keep the UI compatible.
        postingBalance: centsToDollars(centsFromDb(u.postingBalanceCents)),
        stripeConnectStatus: u.stripeConnectStatus,
        createdAt: u.createdAt.toISOString(),
      }),
    );
  },
);

export default router;
