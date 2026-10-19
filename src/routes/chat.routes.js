import express from "express";
import chatController from "../controllers/chat.controller.js";
import streamChatController from "../controllers/chat-stream.controller.js";
import { requireAuth } from "../middleware/require-auth.js";

const router = express.Router();
router.post("/stream", requireAuth, streamChatController);
router.post("/", requireAuth, chatController);

export default router;
