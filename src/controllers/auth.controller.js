import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { getJwtSecret } from "../config/security.js";
import User from "../models/user.model.js";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_MAX_LENGTH = 128;

function createToken(userId) {
  return jwt.sign({}, getJwtSecret(), {
    algorithm: "HS256",
    subject: userId.toString(),
    expiresIn: "7d",
  });
}

function sendAuthResponse(res, user, status = 200) {
  const token = createToken(user._id);
  return res.status(status).json({
    success: true,
    token,
    user: {
      id: user._id.toString(),
      name: user.name,
      email: user.email,
    },
  });
}

export async function register(req, res) {
  const { name, email, password } = req.body ?? {};
  const normalizedEmail = typeof email === "string" ? email.trim().toLowerCase() : "";

  if (
    typeof name !== "string"
    || !name.trim()
    || name.trim().length > 80
    || !EMAIL_PATTERN.test(normalizedEmail)
    || normalizedEmail.length > 254
    || typeof password !== "string"
    || password.length < PASSWORD_MIN_LENGTH
    || password.length > PASSWORD_MAX_LENGTH
  ) {
    return res.status(400).json({
      success: false,
      error: "Enter a name, valid email, and password between 8 and 128 characters.",
    });
  }

  try {
    const passwordHash = await bcrypt.hash(password, 12);
    const user = await User.create({
      name: name.trim(),
      email: normalizedEmail,
      passwordHash,
    });
    return sendAuthResponse(res, user, 201);
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(409).json({
        success: false,
        error: "An account with this email already exists.",
      });
    }
    console.error("Unable to register account:", error);
    return res.status(500).json({
      success: false,
      error: "Unable to create your account right now.",
    });
  }
}

export async function login(req, res) {
  const { email, password } = req.body ?? {};
  const normalizedEmail = typeof email === "string" ? email.trim().toLowerCase() : "";

  if (
    !EMAIL_PATTERN.test(normalizedEmail)
    || normalizedEmail.length > 254
    || typeof password !== "string"
    || !password
    || password.length > PASSWORD_MAX_LENGTH
  ) {
    return res.status(400).json({
      success: false,
      error: "Enter a valid email and password.",
    });
  }

  try {
    const user = await User.findOne({ email: normalizedEmail }).select("+passwordHash");
    const passwordMatches = user
      ? await bcrypt.compare(password, user.passwordHash)
      : false;

    if (!user || !passwordMatches) {
      return res.status(401).json({
        success: false,
        error: "Email or password is incorrect.",
      });
    }

    return sendAuthResponse(res, user);
  } catch (error) {
    console.error("Unable to log in:", error);
    return res.status(500).json({
      success: false,
      error: "Unable to log in right now.",
    });
  }
}
