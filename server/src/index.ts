import express, { type Request, type Response } from "express";
import http from "node:http";
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { checkPassword, hashPassword, tokenFor, verifiedUserId } from "./auth.js";
import { config } from "./config.js";
import { migrate, notifyUserEvent, query, tx } from "./db.js";
import {
  createNote,
  noteAccess,
  notifyParticipants,
  ownedNote,
  participants,
} from "./store.js";
import { sendMail } from "./mail.js";
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

async function authenticatedUser(request: Request): Promise<string | null> {
  return verifiedUserId(request.headers.authorization?.replace(/^Bearer\s+/i, ""));
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
    return response.status(201).json({ token: tokenFor(user.id, 0), user });
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
    token_version: number;
  }>(
    "SELECT id,email,password_hash,created_at,token_version FROM users WHERE lower(email)=lower($1)",
    [parsed.data.email],
  );
  const user = rows[0];
  if (!user || !(await checkPassword(parsed.data.password, user.password_hash))) {
    return response.status(401).json({ error: "Invalid email or password" });
  }
  return response.json({
    token: tokenFor(user.id, user.token_version),
    user: { id: user.id, email: user.email, created_at: user.created_at },
  });
});

const emailPayload = z.object({
  email: z
    .string()
    .email()
    .transform((email) => email.toLowerCase()),
});

app.post("/api/auth/forgot-password", async (request, response) => {
  const parsed = emailPayload.safeParse(request.body);
  if (!parsed.success) {
    return response.status(204).send();
  }
  const rows = await query<{ id: string; email: string }>(
    "SELECT id,email FROM users WHERE lower(email)=lower($1)",
    [parsed.data.email],
  );
  if (rows[0]) {
    const rawToken = randomBytes(32).toString("base64url");
    const tokenHash = createHash("sha256").update(rawToken).digest("hex");
    await tx(async (client) => {
      await client.query(
        "DELETE FROM password_reset_tokens WHERE user_id=$1 AND used_at IS NULL",
        [rows[0].id],
      );
      await client.query(
        "INSERT INTO password_reset_tokens(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')",
        [tokenHash, rows[0].id],
      );
    });
    await sendMail({
      to: rows[0].email,
      subject: "Reset your Syncbook password",
      text: `Reset your Syncbook password with this link:\n${config.appBaseUrl}/?reset=${rawToken}`,
    });
  }
  return response.status(204).send();
});

app.post("/api/auth/reset-password", async (request, response) => {
  const parsed = z
    .object({ token: z.string(), password: z.string().min(8) })
    .safeParse(request.body);
  if (!parsed.success) {
    return response.status(400).json({ error: "Reset link is invalid or has expired" });
  }
  const tokenHash = createHash("sha256").update(parsed.data.token).digest("hex");
  const passwordHash = await hashPassword(parsed.data.password);
  let resetUserId: string | null = null;
  await tx(async (client) => {
    const claimed = await client.query<{ user_id: string }>(
      `UPDATE password_reset_tokens
       SET used_at=now()
       WHERE token_hash=$1 AND used_at IS NULL AND expires_at > now()
       RETURNING user_id`,
      [tokenHash],
    );
    if (!claimed.rows[0]) {
      return;
    }
    const updated = await client.query<{ id: string }>(
      "UPDATE users SET password_hash=$1, token_version=token_version+1 WHERE id=$2 RETURNING id",
      [passwordHash, claimed.rows[0].user_id],
    );
    if (!updated.rows[0]) {
      return;
    }
    resetUserId = updated.rows[0].id;
    await client.query(
      "DELETE FROM password_reset_tokens WHERE user_id=$1 AND used_at IS NULL",
      [resetUserId],
    );
  });
  if (!resetUserId) {
    return response.status(400).json({ error: "Reset link is invalid or has expired" });
  }
  return response.status(204).send();
});

app.post("/api/auth/change-password", async (request, response) => {
  const userId = await authenticatedUser(request);
  if (!userId) {
    return unauthorized(response);
  }
  const parsed = z
    .object({ currentPassword: z.string(), newPassword: z.string().min(8) })
    .safeParse(request.body);
  if (!parsed.success) {
    return response.status(400).json({ error: "Invalid password" });
  }
  const rows = await query<{ password_hash: string; token_version: number }>(
    "SELECT password_hash,token_version FROM users WHERE id=$1",
    [userId],
  );
  if (
    !rows[0] ||
    !(await checkPassword(parsed.data.currentPassword, rows[0].password_hash))
  ) {
    return response.status(400).json({ error: "Current password is incorrect" });
  }
  const passwordHash = await hashPassword(parsed.data.newPassword);
  const updated = await query<{ token_version: number }>(
    "UPDATE users SET password_hash=$1, token_version=token_version+1 WHERE id=$2 RETURNING token_version",
    [passwordHash, userId],
  );
  return response.json({ token: tokenFor(userId, updated[0].token_version) });
});

app.get("/api/me", async (request, response) => {
  const userId = await authenticatedUser(request);
  if (!userId) {
    return unauthorized(response);
  }
  const rows = await query("SELECT id,email,created_at FROM users WHERE id=$1", [userId]);
  return rows[0] ? response.json({ user: rows[0] }) : unauthorized(response);
});

app.get("/api/notes", async (request, response) => {
  const userId = await authenticatedUser(request);
  if (!userId) {
    return unauthorized(response);
  }
  const trash = request.query.trash === "true";
  const condition = trash
    ? "n.owner_id=$1 AND n.deleted_at IS NOT NULL"
    : `(n.deleted_at IS NULL AND (n.owner_id=$1 OR EXISTS (
        SELECT 1 FROM note_shares ns_access
        WHERE ns_access.note_id=n.id AND ns_access.user_id=$1
      )))`;
  const notes = await query(
    `SELECT n.id,n.title,n.excerpt,n.updated_at,n.deleted_at,
            COALESCE(tags.tags, ARRAY[]::text[]) AS tags,
            (n.owner_id=$1) AS owned,
            owner.email AS owner_email
     FROM notes n
     JOIN users owner ON owner.id=n.owner_id
     LEFT JOIN (
       SELECT note_id, array_agg(tag ORDER BY tag) AS tags
       FROM note_tags
       GROUP BY note_id
     ) tags ON tags.note_id=n.id
     WHERE ${condition}
     ORDER BY n.updated_at DESC`,
    [userId],
  );
  return response.json(notes);
});

app.post("/api/notes", async (request, response) => {
  const userId = await authenticatedUser(request);
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
  const userId = await authenticatedUser(request);
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
  await notifyParticipants(request.params.id);
  return response.status(204).send();
});

app.post("/api/notes/:id/restore", async (request, response) => {
  const userId = await authenticatedUser(request);
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
  await notifyParticipants(request.params.id);
  return response.status(204).send();
});

app.get("/api/notes/:id/history", async (request, response) => {
  const userId = await authenticatedUser(request);
  if (!userId || (await noteAccess(request.params.id, userId)) === null) {
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
  const userId = await authenticatedUser(request);
  if (!userId || (await noteAccess(request.params.id, userId)) === null) {
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
  const userId = await authenticatedUser(request);
  if (!userId || (await noteAccess(request.params.id, userId)) === null) {
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

const tagsPayload = z.object({ tags: z.array(z.string()) });

app.put("/api/notes/:id/tags", async (request, response) => {
  const userId = await authenticatedUser(request);
  if (!userId || (await noteAccess(request.params.id, userId)) === null) {
    return response.status(404).json({ error: "Note not found" });
  }
  const parsed = tagsPayload.safeParse(request.body);
  if (!parsed.success) {
    return response.status(400).json({ error: "Invalid tags" });
  }
  const tags = [
    ...new Set(parsed.data.tags.map((tag) => tag.trim().toLowerCase())),
  ].filter(Boolean);
  if (tags.some((tag) => tag.length > 32)) {
    return response.status(400).json({ error: "Tags must be 32 characters or fewer" });
  }
  if (tags.length > 16) {
    return response.status(400).json({ error: "A note can have at most 16 tags" });
  }
  await tx(async (client) => {
    await client.query("DELETE FROM note_tags WHERE note_id=$1", [request.params.id]);
    for (const tag of tags) {
      await client.query("INSERT INTO note_tags(note_id,tag) VALUES($1,$2)", [
        request.params.id,
        tag,
      ]);
    }
  });
  await notifyParticipants(request.params.id);
  return response.json({ tags });
});

app.get("/api/notes/:id/shares", async (request, response) => {
  const userId = await authenticatedUser(request);
  if (!userId || !(await ownedNote(request.params.id, userId))) {
    return response.status(404).json({ error: "Note not found" });
  }
  return response.json(
    await query(
      `SELECT s.user_id,s.created_at,u.email
       FROM note_shares s JOIN users u ON u.id=s.user_id
       WHERE s.note_id=$1 ORDER BY s.created_at`,
      [request.params.id],
    ),
  );
});

const sharePayload = z.object({
  email: z
    .string()
    .email()
    .transform((email) => email.toLowerCase()),
});

app.post("/api/notes/:id/shares", async (request, response) => {
  const userId = await authenticatedUser(request);
  if (!userId || !(await ownedNote(request.params.id, userId))) {
    return response.status(404).json({ error: "Note not found" });
  }
  const parsed = sharePayload.safeParse(request.body);
  if (!parsed.success) {
    return response.status(400).json({ error: "Invalid email" });
  }
  const target = await query<{ id: string; email: string }>(
    "SELECT id,email FROM users WHERE lower(email)=lower($1)",
    [parsed.data.email],
  );
  if (!target[0]) {
    return response.status(404).json({ error: "No user with that email" });
  }
  if (target[0].id === userId) {
    return response.status(400).json({ error: "You cannot share a note with yourself" });
  }
  const inserted = await query<{ user_id: string }>(
    "INSERT INTO note_shares(note_id,user_id) VALUES($1,$2) ON CONFLICT(note_id,user_id) DO NOTHING RETURNING user_id",
    [request.params.id, target[0].id],
  );
  const shares = await query(
    `SELECT s.user_id,s.created_at,u.email
     FROM note_shares s JOIN users u ON u.id=s.user_id
     WHERE s.note_id=$1 AND s.user_id=$2`,
    [request.params.id, target[0].id],
  );
  if (inserted.length > 0) {
    await notifyParticipants(request.params.id, [target[0].id]);
  }
  return response.status(200).json(shares[0]);
});

app.delete("/api/notes/:id/shares/:userId", async (request, response) => {
  const ownerId = await authenticatedUser(request);
  if (!ownerId || !(await ownedNote(request.params.id, ownerId))) {
    return response.status(404).json({ error: "Note not found" });
  }
  if (!z.string().uuid().safeParse(request.params.userId).success) {
    return response.status(404).json({ error: "Share not found" });
  }
  const currentParticipants = await participants(request.params.id);
  const rows = await query(
    "DELETE FROM note_shares WHERE note_id=$1 AND user_id=$2 RETURNING user_id",
    [request.params.id, request.params.userId],
  );
  if (!rows.length) {
    return response.status(404).json({ error: "Share not found" });
  }
  await notifyParticipants(request.params.id, currentParticipants);
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
