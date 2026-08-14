import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { config } from "./config.js";
export type User = { id: string; email: string; created_at: string };
export function tokenFor(id: string): string { return jwt.sign({}, config.jwtSecret, { subject: id, expiresIn: "30d" }); }
export function userIdFromToken(value: string | undefined): string | null {
  if (!value) return null; try { const decoded = jwt.verify(value, config.jwtSecret); return typeof decoded === "object" && typeof decoded.sub === "string" ? decoded.sub : null; } catch { return null; }
}
export async function hashPassword(password: string): Promise<string> { return bcrypt.hash(password, 12); }
export async function checkPassword(password: string, hash: string): Promise<boolean> { return bcrypt.compare(password, hash); }
