import { randomUUID } from "node:crypto";
import http from "node:http";
import WebSocket from "ws";
import { WebsocketProvider } from "y-websocket";
import * as Y from "yjs";
import * as awarenessProtocol from "y-protocols/awareness";
import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { tokenFor } from "../src/auth.js";
import { app, server } from "../src/index.js";
import { migrate, query } from "../src/db.js";
import { appendUpdate, snapshot } from "../src/store.js";
import { waitForUserEvents } from "../src/ws.js";

let ownerToken = "";
let otherToken = "";
let ownerNoteId = "";
let serverPort = 0;

async function createUser(email: string): Promise<{ id: string; token: string }> {
  const rows = await query<{ id: string }>(
    "INSERT INTO users(email,password_hash) VALUES($1,$2) RETURNING id",
    [email, "test-hash"],
  );
  return { id: rows[0].id, token: tokenFor(rows[0].id) };
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

function setEditorText(doc: Y.Doc, value: string): void {
  const fragment = doc.getXmlFragment("prosemirror");
  doc.transact(() => {
    fragment.delete(0, fragment.length);
    const paragraph = new Y.XmlElement("paragraph");
    paragraph.insert(0, [new Y.XmlText(value)]);
    fragment.insert(0, [paragraph]);
  });
}

function editorText(doc: Y.Doc): string {
  return doc.getXmlFragment("prosemirror").toString();
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let index = 0; index < 100; index += 1) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Timed out waiting for condition");
}

beforeAll(async () => {
  await migrate();
  await waitForUserEvents();
  const owner = await createUser(`owner-${randomUUID()}@example.com`);
  const other = await createUser(`other-${randomUUID()}@example.com`);
  ownerToken = owner.token;
  otherToken = other.token;
  const note = await request(app)
    .post("/api/notes")
    .set("Authorization", `Bearer ${ownerToken}`)
    .expect(201);
  ownerNoteId = note.body.id as string;
  await new Promise<void>((resolve) => {
    server.listen(0, () => resolve());
  });
  serverPort = (server.address() as http.AddressInfo).port;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

describe("note ownership", () => {
  it("hides an owner's note from every note-id route", async () => {
    const routes = [
      ["delete", `/api/notes/${ownerNoteId}`],
      ["post", `/api/notes/${ownerNoteId}/restore`],
      ["get", `/api/notes/${ownerNoteId}/history`],
      ["get", `/api/notes/${ownerNoteId}/history/${randomUUID()}`],
      ["post", `/api/notes/${ownerNoteId}/history/${randomUUID()}/restore`],
    ] as const;

    for (const [method, path] of routes) {
      await request(app)
        [method](path)
        .set("Authorization", `Bearer ${otherToken}`)
        .expect(404);
    }
  });
});

describe("WebSocket upgrade authentication", () => {
  it("rejects bad tokens and non-owned notes", async () => {
    const base = `ws://localhost:${serverPort}/ws/${ownerNoteId}`;
    await expect(websocketStatus(`${base}?token=bad-token`)).resolves.toBe(401);
    await expect(
      websocketStatus(`${base}?token=${encodeURIComponent(otherToken)}`),
    ).resolves.toBe(401);
  });
});

describe("awareness bootstrap", () => {
  it("sends existing awareness state to a joining peer", async () => {
    const note = await request(app)
      .post("/api/notes")
      .set("Authorization", `Bearer ${ownerToken}`)
      .expect(201);
    const noteUrl = `ws://localhost:${serverPort}/ws/${note.body.id as string}?token=${encodeURIComponent(ownerToken)}`;
    const first = new WebSocket(noteUrl);
    await new Promise<void>((resolve, reject) => {
      first.once("open", () => resolve());
      first.once("error", reject);
    });
    const firstAwareness = new awarenessProtocol.Awareness(new Y.Doc());
    firstAwareness.setLocalStateField("user", {
      name: "first-peer",
      color: "#3f5dce",
    });
    const awarenessUpdate = awarenessProtocol.encodeAwarenessUpdate(firstAwareness, [
      firstAwareness.clientID,
    ]);
    const awarenessMessage = encoding.createEncoder();
    encoding.writeVarUint(awarenessMessage, 1);
    encoding.writeVarUint8Array(awarenessMessage, awarenessUpdate);
    first.send(encoding.toUint8Array(awarenessMessage));
    await new Promise((resolve) => setTimeout(resolve, 100));

    const second = new WebSocket(noteUrl);
    const received = new Promise<Record<number, Record<string, unknown>>>(
      (resolve, reject) => {
        second.on("message", (data) => {
          const decoder = decoding.createDecoder(new Uint8Array(data as Buffer));
          if (decoding.readVarUint(decoder) !== 1) {
            return;
          }
          const update = decoding.readVarUint8Array(decoder);
          const decodedAwareness = new awarenessProtocol.Awareness(new Y.Doc());
          awarenessProtocol.applyAwarenessUpdate(decodedAwareness, update, null);
          resolve(
            Object.fromEntries(
              [...decodedAwareness.getStates()].map(([clientId, state]) => [
                clientId,
                state as Record<string, unknown>,
              ]),
            ),
          );
        });
        second.once("error", reject);
      },
    );
    await new Promise<void>((resolve, reject) => {
      second.once("open", () => resolve());
      second.once("error", reject);
    });
    const states = await received;
    expect(Object.values(states)).toContainEqual({
      user: { name: "first-peer", color: "#3f5dce" },
    });
    await Promise.all(
      [first, second].map(
        (socket) =>
          new Promise<void>((resolve) => {
            socket.once("close", () => resolve());
            socket.close();
          }),
      ),
    );
  });
});

describe("user notification channel", () => {
  it("notifies metadata, create, and delete changes without duplicate handlers", async () => {
    const socket = new WebSocket(
      `ws://localhost:${serverPort}/ws/user?token=${encodeURIComponent(ownerToken)}`,
    );
    await new Promise<void>((resolve, reject) => {
      socket.once("open", () => resolve());
      socket.once("error", reject);
    });
    const nextEvent = (): Promise<{ type: string }> =>
      new Promise((resolve, reject) => {
        socket.once("message", (data) => resolve(JSON.parse(data.toString())));
        socket.once("error", reject);
      });

    const createdEvent = nextEvent();
    const created = await request(app)
      .post("/api/notes")
      .set("Authorization", `Bearer ${ownerToken}`)
      .expect(201);
    await expect(createdEvent).resolves.toEqual({ type: "notes-changed" });

    const metadataDoc = new Y.Doc();
    setEditorText(metadataDoc, "metadata title");
    const metadataEvent = nextEvent();
    await appendUpdate(
      created.body.id as string,
      Y.encodeStateAsUpdate(metadataDoc),
      metadataDoc,
    );
    await expect(metadataEvent).resolves.toEqual({ type: "notes-changed" });

    const unchangedEvent = nextEvent();
    await appendUpdate(
      created.body.id as string,
      Y.encodeStateAsUpdate(metadataDoc),
      metadataDoc,
    );
    await expect(
      Promise.race([
        unchangedEvent.then(() => true),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 200)),
      ]),
    ).resolves.toBe(false);

    const deletedEvent = nextEvent();
    await request(app)
      .delete(`/api/notes/${created.body.id as string}`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .expect(204);
    await expect(deletedEvent).resolves.toEqual({ type: "notes-changed" });
    await new Promise<void>((resolve) => {
      socket.once("close", () => resolve());
      socket.close();
    });
  });
});

describe("live restore convergence", () => {
  it("converges two connected clients after an HTTP restore", async () => {
    const note = await request(app)
      .post("/api/notes")
      .set("Authorization", `Bearer ${ownerToken}`)
      .expect(201);
    const liveNoteId = note.body.id as string;
    const first = new Y.Doc();
    const second = new Y.Doc();
    const url = `ws://localhost:${serverPort}/ws`;
    const options = {
      WebSocketPolyfill: WebSocket,
      disableBc: true,
      params: { token: ownerToken },
    };
    const firstProvider = new WebsocketProvider(url, liveNoteId, first, options);
    const secondProvider = new WebsocketProvider(url, liveNoteId, second, options);
    await waitFor(() => firstProvider.wsconnected && secondProvider.wsconnected);

    setEditorText(first, "first version");
    await waitFor(() => editorText(second).includes("first version"));
    await snapshot(liveNoteId, first);

    setEditorText(first, "second version");
    await waitFor(() => editorText(second).includes("second version"));

    const history = await request(app)
      .get(`/api/notes/${liveNoteId}/history`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .expect(200);
    const firstSnapshot = history.body.at(-1) as { id: string };
    await request(app)
      .post(`/api/notes/${liveNoteId}/history/${firstSnapshot.id}/restore`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .expect(204);

    await waitFor(
      () =>
        editorText(first).includes("first version") &&
        editorText(second).includes("first version"),
    );
    firstProvider.destroy();
    secondProvider.destroy();
  });
});
