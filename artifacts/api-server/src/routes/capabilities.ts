import { Router, type IRouter } from "express";
import { db, capabilitiesTable } from "@workspace/db";
import { ListCapabilitiesResponse } from "@workspace/api-zod";
import { capabilitiesCache } from "../lib/cache";

const router: IRouter = Router();

router.get("/capabilities", async (_req, res): Promise<void> => {
  const dto = await capabilitiesCache.wrap("all", async () => {
    const rows = await db
      .select()
      .from(capabilitiesTable)
      .orderBy(capabilitiesTable.category, capabilitiesTable.name);
    return ListCapabilitiesResponse.parse(rows);
  });
  res.setHeader("Cache-Control", "public, max-age=60, must-revalidate");
  res.json(dto);
});

export default router;
