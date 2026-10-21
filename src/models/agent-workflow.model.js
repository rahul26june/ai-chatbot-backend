import mongoose from "mongoose";

const agentStepSchema = new mongoose.Schema(
  {
    agent: {
      type: String,
      enum: ["research", "coding", "review", "summary"],
      required: true,
    },
    status: {
      type: String,
      enum: ["pending", "running", "completed", "failed"],
      default: "pending",
    },
    provider: {
      type: String,
      enum: ["gemini", "openai", "deepseek", "claude"],
    },
    model: String,
    inputTokens: Number,
    outputTokens: Number,
    estimatedCostUsd: {
      type: Number,
      min: 0,
    },
    output: {
      type: String,
      default: "",
      maxlength: 12_000,
    },
    startedAt: Date,
    completedAt: Date,
  },
  { _id: false },
);

const agentWorkflowSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    task: {
      type: String,
      required: true,
      maxlength: 4000,
    },
    provider: {
      type: String,
      required: true,
      enum: ["gemini", "openai", "deepseek", "claude"],
    },
    status: {
      type: String,
      enum: ["queued", "running", "completed", "failed"],
      default: "queued",
    },
    currentAgent: {
      type: String,
      enum: ["research", "coding", "review", "summary"],
      default: null,
    },
    progress: {
      type: Number,
      min: 0,
      max: 100,
      default: 0,
    },
    error: {
      type: String,
      maxlength: 200,
      default: null,
    },
    steps: {
      type: [agentStepSchema],
      default: [],
    },
  },
  { timestamps: true },
);

agentWorkflowSchema.index({ user: 1, createdAt: -1 });

const AgentWorkflow = mongoose.model("AgentWorkflow", agentWorkflowSchema);

export default AgentWorkflow;
