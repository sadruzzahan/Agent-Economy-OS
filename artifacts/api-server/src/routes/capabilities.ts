import { Router, type IRouter } from "express";
import { db, capabilitiesTable } from "@workspace/db";
import { ListCapabilitiesResponse } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/capabilities", async (_req, res): Promise<void> => {
  const rows = await db
    .select()
    .from(capabilitiesTable)
    .orderBy(capabilitiesTable.category, capabilitiesTable.name);
  res.json(ListCapabilitiesResponse.parse(rows));
});

export default router;
