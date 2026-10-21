import express from "express";
import { get, list, start } from "../controllers/agent-workflow.controller.js";
import { requireAuth } from "../middleware/require-auth.js";

const router = express.Router();

router.use(requireAuth);
router.get("/", list);
router.post("/workflows", start);
router.get("/workflows/:id", get);

export default router;
