import mongoose from "mongoose";

const messageSchema = new mongoose.Schema(
  {
    role: {
      type: String,
      enum: ["user", "assistant"],
      required: true,
    },
    text: {
      type: String,
      required: true,
      maxlength: 4000,
    },
  },
  { timestamps: true },
);

export default messageSchema;
