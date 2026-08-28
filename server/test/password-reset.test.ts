import { randomBytes, randomUUID } from "node:crypto";
import http from "node:http";
import WebSocket from "ws";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { checkPassword, hashPassword, tokenFor } from "../src/auth.js";
import { config } from "../src/config.js";
import { migrate, query } from "../src/db.js";
import { app, server } from "../src/index.js";
import {
  resetMailSender,
  sendMail,
  setMailSender,
  type MailMessage,
} from "../src/mail.js";

let serverPort = 0;
let email = "";
let password = "";
let userId = "";
const messages: MailMessage[] = [];

async function createTestUser(): Promise<void> {
  email = `reset-${randomUUID()}@example.com`;
  password = "old password";
  const rows = await query<{ id: string }>(
    "INSERT INTO users(email,password_hash) VALUES($1,$2) RETURNING id",
    [email, await hashPassword(password)],
  );
  userId = rows[0].id;
}

function auth(token: string): { Authorization: string } {
  return { Authorization: `Bearer ${token}` };
}

function resetTokenFromMessage(message: MailMessage): string {
  const match = message.text.match(/\?reset=([^\s]+)/);
  if (!match) {
    throw new Error("Reset link missing from message");
  }
  return match[1];
}

function websocketStatus(url: string): Promise<number | "open"> {
  return new Promise((resolve) => {
    const socket = new WebSocket(url);
    socket.once("open", () => {
      socket.close();
      resolve("open");
    });
    socket.once("unexpected-response", (_request, response) => {
      socket.close();
      resolve(response.statusCode);
    });
    socket.once("error", () => resolve(401));
  });
}

beforeAll(async () => {
  await migrate();
  await new Promise<void>((resolve) => {
    server.listen(0, () => resolve());
  });
  serverPort = (server.address() as http.AddressInfo).port;
});

beforeEach(async () => {
  messages.length = 0;
  setMailSender(async (message) => {
    messages.push(message);
  });
  await createTestUser();
});

afterAll(async () => {
  resetMailSender();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

describe("password reset", () => {
  it("returns 204 for unknown and known addresses, creating only known tokens", async () => {
    await request(app)
      .post("/api/auth/forgot-password")
      .send({ email: "missing@example.com" })
      .expect(204);
    expect(messages).toHaveLength(0);
    const before = await query<{ count: string }>(
      "SELECT count(*) FROM password_reset_tokens WHERE user_id=$1",
      [userId],
    );
    expect(before[0].count).toBe("0");

    await request(app).post("/api/auth/forgot-password").send({ email }).expect(204);
    expect(messages).toHaveLength(1);
    const after = await query<{ count: string }>(
      "SELECT count(*) FROM password_reset_tokens WHERE user_id=$1",
      [userId],
    );
    expect(after[0].count).toBe("1");
  });

  it("resets through the captured link and invalidates the old password and session", async () => {
    const oldToken = tokenFor(userId);
    await request(app).post("/api/auth/forgot-password").send({ email }).expect(204);
    const rawToken = resetTokenFromMessage(messages[0]);

    await request(app)
      .post("/api/auth/reset-password")
      .send({ token: rawToken, password: "new password" })
      .expect(204);
    await request(app)
      .post("/api/auth/login")
      .send({ email, password: "new password" })
      .expect(200);
    await request(app).post("/api/auth/login").send({ email, password }).expect(401);
    await request(app).get("/api/me").set(auth(oldToken)).expect(401);
    await expect(
      websocketStatus(
        `ws://localhost:${serverPort}/ws/not-a-note?token=${encodeURIComponent(oldToken)}`,
      ),
    ).resolves.toBe(401);
  });

  it("rejects single-use, expired, and tampered reset tokens", async () => {
    await request(app).post("/api/auth/forgot-password").send({ email }).expect(204);
    const rawToken = resetTokenFromMessage(messages[0]);
    await request(app)
      .post("/api/auth/reset-password")
      .send({ token: rawToken, password: "new password" })
      .expect(204);
    await request(app)
      .post("/api/auth/reset-password")
      .send({ token: rawToken, password: "another password" })
      .expect(400, { error: "Reset link is invalid or has expired" });
    await request(app)
      .post("/api/auth/reset-password")
      .send({ token: randomBytes(32).toString("base64url"), password: "new password" })
      .expect(400, { error: "Reset link is invalid or has expired" });

    messages.length = 0;
    await request(app).post("/api/auth/forgot-password").send({ email }).expect(204);
    const expiredToken = resetTokenFromMessage(messages[0]);
    await query(
      "UPDATE password_reset_tokens SET expires_at=now()-interval '1 minute' WHERE user_id=$1",
      [userId],
    );
    await request(app)
      .post("/api/auth/reset-password")
      .send({ token: expiredToken, password: "new password" })
      .expect(400, { error: "Reset link is invalid or has expired" });
  });

  it("changes a password without expiring the session on a wrong current password", async () => {
    const oldToken = tokenFor(userId);
    await request(app)
      .post("/api/auth/change-password")
      .set(auth(oldToken))
      .send({ currentPassword: "wrong", newPassword: "new password" })
      .expect(400);
    await request(app).get("/api/me").set(auth(oldToken)).expect(200);

    const changed = await request(app)
      .post("/api/auth/change-password")
      .set(auth(oldToken))
      .send({ currentPassword: password, newPassword: "new password" })
      .expect(200);
    await request(app)
      .get("/api/me")
      .set(auth(changed.body.token as string))
      .expect(200);
    await request(app).get("/api/me").set(auth(oldToken)).expect(401);
  });
});

describe("default mail sender", () => {
  it("logs the configured base URL and raw token without SMTP", async () => {
    resetMailSender();
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    try {
      const rawToken = randomBytes(32).toString("base64url");
      await sendMail({
        to: email,
        subject: "Reset",
        text: `${config.appBaseUrl}/?reset=${rawToken}`,
      });
      expect(log).toHaveBeenCalledWith(
        "Syncbook email",
        expect.objectContaining({
          to: email,
          text: expect.stringContaining(`${config.appBaseUrl}/?reset=${rawToken}`),
        }),
      );
    } finally {
      log.mockRestore();
    }
  });
});

describe("token helpers", () => {
  it("still verifies the stored password hash through the existing primitive", async () => {
    const rows = await query<{ password_hash: string }>(
      "SELECT password_hash FROM users WHERE id=$1",
      [userId],
    );
    await expect(checkPassword(password, rows[0].password_hash)).resolves.toBe(true);
  });
});
