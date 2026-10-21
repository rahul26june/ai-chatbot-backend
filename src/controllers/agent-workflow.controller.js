import mongoose from "mongoose";
import { getAiProvider } from "../config/ai.config.js";
import AgentWorkflow from "../models/agent-workflow.model.js";
import redisClient from "../config/redis.js";
import { supportedProviders } from "../providers/provider.factory.js";
import { logException } from "../observability/logger.js";
import { createAgentWorkflowEngine } from "../services/agent-workflow.service.js";

const engine = createAgentWorkflowEngine({
  WorkflowModel: AgentWorkflow,
  redis: redisClient,
});

const MAX_TASK_LENGTH = 4000;

export async function start(req, res) {
  const { task, provider: requestedProvider } = req.body ?? {};
  if (typeof task !== "string" || !task.trim() || task.length > MAX_TASK_LENGTH) {
    return res.status(400).json({
      success: false,
      error: `Task must contain between 1 and ${MAX_TASK_LENGTH} characters.`,
    });
  }
  if (
    requestedProvider !== undefined
    && (typeof requestedProvider !== "string" || !supportedProviders.includes(requestedProvider))
  ) {
    return res.status(400).json({
      success: false,
      error: `Provider must be one of: ${supportedProviders.join(", ")}.`,
    });
  }

  let provider;
  try {
    provider = getAiProvider(requestedProvider);
  } catch {
    return res.status(400).json({
      success: false,
      error: "The requested AI provider is not configured.",
    });
  }

  try {
    const { workflow, completion } = await engine.start({
      userId: req.auth.userId,
      task: task.trim(),
      provider,
    });
    completion.catch((error) => {
      logException("agent.workflow.unhandled_failure", error, {
        requestId: req.id,
        workflowId: workflow.id,
      });
    });
    return res.status(202).json({ success: true, workflow });
  } catch (error) {
    logException("agent.workflow.start_failed", error, { requestId: req.id });
    return res.status(500).json({
      success: false,
      error: "Unable to start the agent workflow.",
      requestId: req.id,
    });
  }
}

export async function get(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(400).json({
      success: false,
      error: "Workflow ID is invalid.",
    });
  }
  try {
    const workflow = await engine.get(req.auth.userId, req.params.id);
    if (!workflow) {
      return res.status(404).json({
        success: false,
        error: "Workflow was not found.",
      });
    }
    return res.status(200).json({ success: true, workflow });
  } catch (error) {
    logException("agent.workflow.load_failed", error, { requestId: req.id });
    return res.status(500).json({
      success: false,
      error: "Unable to load the agent workflow.",
      requestId: req.id,
    });
  }
}

export async function list(req, res) {
  try {
    const workflows = await engine.list(req.auth.userId);
    return res.status(200).json({ success: true, workflows });
  } catch (error) {
    logException("agent.workflow.list_failed", error, { requestId: req.id });
    return res.status(500).json({
      success: false,
      error: "Unable to list agent workflows.",
      requestId: req.id,
    });
  }
}
