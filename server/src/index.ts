import express, { type Request, type Response } from "express";
import http from "node:http";
import { z } from "zod";
import { checkPassword, hashPassword, tokenFor, userIdFromToken } from "./auth.js";
import { config } from "./config.js";
import { migrate, notifyUserEvent, query } from "./db.js";
import { createNote, ownedNote } from "./store.js";
import { attachWs, restoreAndBroadcast } from "./ws.js";

const app = express();
app.use(express.json());

const credentials = z.object({
  email: z
    .string()
    .email()
    .transform((email) => email.toLowerCase()),
  password: z.string().min(8),
});

function authenticatedUser(request: Request): string | null {
  return userIdFromToken(request.headers.authorization?.replace(/^Bearer\s+/i, ""));
}

function unauthorized(response: Response): Response {
  return response.status(401).json({ error: "Unauthorized" });
}

app.get("/api/health", (_request, response) => {
  response.json({ ok: true });
});

app.post("/api/auth/register", async (request, response) => {
  const parsed = credentials.safeParse(request.body);
  if (!parsed.success) {
    return response.status(400).json({ error: "Invalid credentials" });
  }
  try {
    const rows = await query<{ id: string; email: string; created_at: string }>(
      "INSERT INTO users(email,password_hash) VALUES($1,$2) RETURNING id,email,created_at",
      [parsed.data.email, await hashPassword(parsed.data.password)],
    );
    const user = rows[0];
    return response.status(201).json({ token: tokenFor(user.id), user });
  } catch {
    return response.status(409).json({ error: "Email is already registered" });
  }
});

app.post("/api/auth/login", async (request, response) => {
  const parsed = credentials.safeParse(request.body);
  if (!parsed.success) {
    return response.status(401).json({ error: "Invalid email or password" });
  }
  const rows = await query<{
    id: string;
    email: string;
    password_hash: string;
    created_at: string;
  }>("SELECT id,email,password_hash,created_at FROM users WHERE lower(email)=lower($1)", [
    parsed.data.email,
  ]);
  const user = rows[0];
  if (!user || !(await checkPassword(parsed.data.password, user.password_hash))) {
    return response.status(401).json({ error: "Invalid email or password" });
  }
  return response.json({
    token: tokenFor(user.id),
    user: { id: user.id, email: user.email, created_at: user.created_at },
  });
});

app.get("/api/me", async (request, response) => {
  const userId = authenticatedUser(request);
  if (!userId) {
    return unauthorized(response);
  }
  const rows = await query("SELECT id,email,created_at FROM users WHERE id=$1", [userId]);
  return rows[0] ? response.json({ user: rows[0] }) : unauthorized(response);
});

app.get("/api/notes", async (request, response) => {
  const userId = authenticatedUser(request);
  if (!userId) {
    return unauthorized(response);
  }
  const condition =
    request.query.trash === "true" ? "deleted_at IS NOT NULL" : "deleted_at IS NULL";
  const notes = await query(
    `SELECT id,title,excerpt,updated_at,deleted_at FROM notes WHERE owner_id=$1 AND ${condition} ORDER BY updated_at DESC`,
    [userId],
  );
  return response.json(notes);
});

app.post("/api/notes", async (request, response) => {
  const userId = authenticatedUser(request);
  if (!userId) {
    return unauthorized(response);
  }
  const note = await createNote(userId);
  void notifyUserEvent(userId, "notes-changed").catch((error: unknown) => {
    console.error("Failed to publish note event", error);
  });
  return response.status(201).json(note);
});

app.delete("/api/notes/:id", async (request, response) => {
  const userId = authenticatedUser(request);
  if (!userId) {
    return unauthorized(response);
  }
  const rows = await query(
    "UPDATE notes SET deleted_at=now() WHERE id=$1 AND owner_id=$2 RETURNING id",
    [request.params.id, userId],
  );
  if (!rows.length) {
    return response.status(404).json({ error: "Note not found" });
  }
  void notifyUserEvent(userId, "notes-changed").catch((error: unknown) => {
    console.error("Failed to publish note event", error);
  });
  return response.status(204).send();
});

app.post("/api/notes/:id/restore", async (request, response) => {
  const userId = authenticatedUser(request);
  if (!userId) {
    return unauthorized(response);
  }
  const rows = await query(
    "UPDATE notes SET deleted_at=NULL WHERE id=$1 AND owner_id=$2 RETURNING id",
    [request.params.id, userId],
  );
  if (!rows.length) {
    return response.status(404).json({ error: "Note not found" });
  }
  void notifyUserEvent(userId, "notes-changed").catch((error: unknown) => {
    console.error("Failed to publish note event", error);
  });
  return response.status(204).send();
});

app.get("/api/notes/:id/history", async (request, response) => {
  const userId = authenticatedUser(request);
  if (!userId || !(await ownedNote(request.params.id, userId))) {
    return response.status(404).json({ error: "Note not found" });
  }
  return response.json(
    await query(
      "SELECT id,created_at,excerpt FROM note_snapshots WHERE note_id=$1 ORDER BY created_at DESC",
      [request.params.id],
    ),
  );
});

app.get("/api/notes/:id/history/:snapshotId", async (request, response) => {
  const userId = authenticatedUser(request);
  if (!userId || !(await ownedNote(request.params.id, userId))) {
    return response.status(404).json({ error: "Note not found" });
  }
  const rows = await query(
    "SELECT id,created_at,excerpt,encode(state,'base64') AS state FROM note_snapshots WHERE id=$1 AND note_id=$2",
    [request.params.snapshotId, request.params.id],
  );
  return rows[0]
    ? response.json(rows[0])
    : response.status(404).json({ error: "Snapshot not found" });
});

app.post("/api/notes/:id/history/:snapshotId/restore", async (request, response) => {
  const userId = authenticatedUser(request);
  if (!userId || !(await ownedNote(request.params.id, userId))) {
    return response.status(404).json({ error: "Note not found" });
  }
  const rows = await query<{ state: Buffer }>(
    "SELECT state FROM note_snapshots WHERE id=$1 AND note_id=$2",
    [request.params.snapshotId, request.params.id],
  );
  if (!rows[0]) {
    return response.status(404).json({ error: "Snapshot not found" });
  }
  await restoreAndBroadcast(request.params.id, new Uint8Array(rows[0].state));
  return response.status(204).send();
});

app.use((_request, response) => {
  response.status(404).json({ error: "Not found" });
});

const server = http.createServer(app);
attachWs(server);
await migrate();
if (!process.env.VITEST) {
  server.listen(config.port, () => {
    console.log(`Syncbook server listening on ${config.port}`);
  });
}

export { app, server };
