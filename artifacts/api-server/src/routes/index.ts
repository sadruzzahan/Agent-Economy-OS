import { Router, type IRouter } from "express";
import healthRouter from "./health";
import meRouter from "./me";
import capabilitiesRouter from "./capabilities";
import agentsRouter from "./agents";
import tasksRouter from "./tasks";
import walletsRouter from "./wallets";
import reputationRouter from "./reputation";
import dashboardRouter from "./dashboard";
import runtimeRouter from "./runtime";

const router: IRouter = Router();

router.use(healthRouter);
router.use(meRouter);
router.use(capabilitiesRouter);
router.use(agentsRouter);
router.use(tasksRouter);
router.use(walletsRouter);
router.use(reputationRouter);
router.use(dashboardRouter);
router.use(runtimeRouter);

export default router;
