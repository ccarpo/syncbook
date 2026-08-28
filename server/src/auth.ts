import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { config } from "./config.js";
import { query } from "./db.js";
export type User = { id: string; email: string; created_at: string };
export function tokenFor(id: string, tokenVersion = 0): string {
  return jwt.sign({ tv: tokenVersion }, config.jwtSecret, {
    subject: id,
    expiresIn: "30d",
  });
}
export function userIdFromToken(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const decoded = jwt.verify(value, config.jwtSecret);
    return typeof decoded === "object" && typeof decoded.sub === "string"
      ? decoded.sub
      : null;
  } catch {
    return null;
  }
}
export async function verifiedUserId(value: string | undefined): Promise<string | null> {
  if (!value) {
    return null;
  }
  try {
    const decoded = jwt.verify(value, config.jwtSecret);
    if (typeof decoded !== "object" || typeof decoded.sub !== "string") {
      return null;
    }
    const userId = decoded.sub;
    const tokenVersion = typeof decoded.tv === "number" ? decoded.tv : 0;
    const rows = await query<{ token_version: number }>(
      "SELECT token_version FROM users WHERE id=$1",
      [userId],
    );
    return rows[0] && rows[0].token_version === tokenVersion ? userId : null;
  } catch {
    return null;
  }
}
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}
export async function checkPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}
