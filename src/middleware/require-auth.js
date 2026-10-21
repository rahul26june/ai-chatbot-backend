import jwt from "jsonwebtoken";
import { getJwtSecret } from "../config/security.js";
import { logger } from "../observability/logger.js";

export function requireAuth(req, res, next) {
  const authorization = req.get("authorization") ?? "";
  const match = authorization.match(/^Bearer\s+(\S+)$/i);
  if (!match) {
    return res.status(401).json({
      success: false,
      error: "Authentication is required.",
    });
  }
  const [, token] = match;

  let secret;
  try {
    secret = getJwtSecret();
  } catch {
    logger.error("auth.configuration_error", { setting: "JWT_SECRET" });
    return res.status(500).json({
      success: false,
      error: "Authentication is not configured.",
    });
  }

  try {
    const payload = jwt.verify(token, secret, { algorithms: ["HS256"] });
    if (typeof payload !== "object" || typeof payload.sub !== "string") {
      return res.status(401).json({
        success: false,
        error: "Authentication token is invalid.",
      });
    }
    req.auth = { userId: payload.sub };
    return next();
  } catch {
    return res.status(401).json({
      success: false,
      error: "Authentication token is invalid or expired.",
    });
  }
}
