import { Router, type IRouter } from "express";
import { requireAuth } from "../lib/auth";
import { GetMeResponse } from "@workspace/api-zod";
import { n } from "../lib/serialize";
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
        postingBalance: n(u.postingBalance),
        createdAt: u.createdAt.toISOString(),
      }),
    );
  },
);

export default router;
