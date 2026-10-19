import express from "express";
import {
  create,
  get,
  list,
  remove,
} from "../controllers/conversation.controller.js";
import { requireAuth } from "../middleware/require-auth.js";

const router = express.Router();

router.use(requireAuth);
router.get("/", list);
router.post("/", create);
router.get("/:id", get);
router.delete("/:id", remove);

export default router;
