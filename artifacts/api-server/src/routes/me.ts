import { Router, type IRouter } from "express";
import { requireAuth } from "../lib/auth";
import { GetMeResponse } from "@workspace/api-zod";
import { n } from "../lib/serialize";

const router: IRouter = Router();

router.get("/me", requireAuth, async (req, res): Promise<void> => {
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
});

export default router;
