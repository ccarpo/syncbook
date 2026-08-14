import type { IncomingMessage, Server } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import * as Y from "yjs";
import * as awarenessProtocol from "y-protocols/awareness";
import * as syncProtocol from "y-protocols/sync";
import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import { userIdFromToken } from "./auth.js";
import {
  appendUpdate,
  compactIfNeeded,
  COMPACTION_THRESHOLD,
  loadDoc,
  ownedNote,
  snapshot,
} from "./store.js";

const SYNC = 0;
const AWARENESS = 1;
const UPDATE = 2;

type Room = {
  noteId: string;
  doc: Y.Doc;
  awareness: awarenessProtocol.Awareness;
  peers: Set<WebSocket>;
  updatesSinceCompaction: number;
  snapshotTimer?: ReturnType<typeof setTimeout>;
  lastSnapshot: number;
};

const rooms = new Map<string, Room>();

async function getRoom(noteId: string): Promise<Room> {
  const existing = rooms.get(noteId);
  if (existing) {
    return existing;
  }
  const doc = await loadDoc(noteId);
  const room: Room = {
    noteId,
    doc,
    awareness: new awarenessProtocol.Awareness(doc),
    peers: new Set(),
    updatesSinceCompaction: 0,
    lastSnapshot: 0,
  };
  rooms.set(noteId, room);
  return room;
}

function scheduleSnapshot(room: Room): void {
  if (room.snapshotTimer) {
    clearTimeout(room.snapshotTimer);
  }
  room.snapshotTimer = setTimeout(() => {
    if (Date.now() - room.lastSnapshot >= 10_000) {
      void snapshot(room.noteId, room.doc);
      room.lastSnapshot = Date.now();
    }
  }, 3_000);
}

function updateMessage(update: Uint8Array): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, SYNC);
  encoding.writeVarUint(encoder, UPDATE);
  encoding.writeVarUint8Array(encoder, update);
  return encoding.toUint8Array(encoder);
}

function broadcast(room: Room, message: Uint8Array, except?: WebSocket): void {
  for (const peer of room.peers) {
    if (peer !== except && peer.readyState === WebSocket.OPEN) {
      peer.send(message);
    }
  }
}

export async function applyAndBroadcast(
  noteId: string,
  update: Uint8Array,
): Promise<void> {
  const room = rooms.get(noteId);
  if (!room) {
    const doc = await loadDoc(noteId);
    Y.applyUpdate(doc, update, "server");
    await appendUpdate(noteId, update, doc);
    return;
  }
  Y.applyUpdate(room.doc, update, "server");
  await appendUpdate(noteId, update, room.doc);
  broadcast(room, updateMessage(update));
  scheduleSnapshot(room);
}

export async function restoreAndBroadcast(
  noteId: string,
  snapshotUpdate: Uint8Array,
): Promise<void> {
  const existing = rooms.get(noteId);
  if (!existing) {
    const doc = await loadDoc(noteId);
    const restored = new Y.Doc();
    Y.applyUpdate(restored, snapshotUpdate);
    const currentXml = doc.getXmlFragment("prosemirror");
    const restoredXml = restored.getXmlFragment("prosemirror");
    const children = restoredXml
      .toArray()
      .filter(
        (child): child is Y.XmlElement | Y.XmlText =>
          child instanceof Y.XmlElement || child instanceof Y.XmlText,
      )
      .map((child) => child.clone());
    doc.transact(() => {
      currentXml.delete(0, currentXml.length);
      currentXml.insert(0, children);
    }, "restore");
    const update = Y.encodeStateAsUpdate(doc);
    if (update.byteLength > 0) {
      await appendUpdate(noteId, update, doc);
    }
    return;
  }
  const room = existing;
  const restored = new Y.Doc();
  Y.applyUpdate(restored, snapshotUpdate);
  const before = Y.encodeStateVector(room.doc);
  const currentXml = room.doc.getXmlFragment("prosemirror");
  const restoredXml = restored.getXmlFragment("prosemirror");
  const children = restoredXml
    .toArray()
    .filter(
      (child): child is Y.XmlElement | Y.XmlText =>
        child instanceof Y.XmlElement || child instanceof Y.XmlText,
    )
    .map((child) => child.clone());

  room.doc.transact(() => {
    currentXml.delete(0, currentXml.length);
    currentXml.insert(0, children);
  }, "restore");

  const update = Y.encodeStateAsUpdate(room.doc, before);
  if (update.byteLength === 0) {
    return;
  }
  await appendUpdate(noteId, update, room.doc);
  broadcast(room, updateMessage(update));
  scheduleSnapshot(room);
}

function rejectUpgrade(socket: NodeJS.WritableStream & { destroy(): void }): void {
  socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
  socket.destroy();
}

export function attachWs(server: Server): void {
  const wss = new WebSocketServer({ noServer: true });
  server.on("upgrade", async (request: IncomingMessage, socket, head) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    const noteId = url.searchParams.get("noteId") ?? url.pathname.replace(/^\/ws\//, "");
    const userId = userIdFromToken(url.searchParams.get("token") ?? undefined);
    if (!noteId || !userId || !(await ownedNote(noteId, userId))) {
      rejectUpgrade(socket);
      return;
    }
    const room = await getRoom(noteId);
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit("connection", ws, room);
    });
  });

  wss.on("connection", (ws: WebSocket, room: Room) => {
    room.peers.add(ws);
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, SYNC);
    syncProtocol.writeSyncStep1(encoder, room.doc);
    ws.send(encoding.toUint8Array(encoder));

    ws.on("message", async (data: Buffer) => {
      const bytes = new Uint8Array(data);
      const decoder = decoding.createDecoder(bytes);
      const type = decoding.readVarUint(decoder);
      if (type === SYNC) {
        const inspect = decoding.createDecoder(bytes);
        decoding.readVarUint(inspect);
        const syncType = decoding.readVarUint(inspect);
        const response = encoding.createEncoder();
        encoding.writeVarUint(response, SYNC);
        syncProtocol.readSyncMessage(decoder, response, room.doc, null);
        if (encoding.length(response) > 1) {
          ws.send(encoding.toUint8Array(response));
        }
        if (syncType === UPDATE) {
          const update = decoding.readVarUint8Array(inspect);
          try {
            await appendUpdate(room.noteId, update, room.doc);
            room.updatesSinceCompaction += 1;
            if (
              room.updatesSinceCompaction >= COMPACTION_THRESHOLD &&
              (await compactIfNeeded(room.noteId, room.doc, room.updatesSinceCompaction))
            ) {
              room.updatesSinceCompaction = 0;
            }
            scheduleSnapshot(room);
          } catch (error) {
            console.error("Failed to persist update", error);
          }
          broadcast(room, updateMessage(update), ws);
        }
      } else if (type === AWARENESS) {
        const update = decoding.readVarUint8Array(decoder);
        const awarenessDecoder = decoding.createDecoder(update);
        const awarenessCount = decoding.readVarUint(awarenessDecoder);
        for (let index = 0; index < awarenessCount; index += 1) {
          const clientId = decoding.readVarUint(awarenessDecoder);
          decoding.readVarUint(awarenessDecoder);
          const state = decoding.readVarString(awarenessDecoder);
          if (state !== "null") {
            awarenessClientIds.add(clientId);
          }
        }
        awarenessProtocol.applyAwarenessUpdate(room.awareness, update, ws);
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, AWARENESS);
        encoding.writeVarUint8Array(encoder, update);
        broadcast(room, encoding.toUint8Array(encoder), ws);
      }
    });

    const awarenessClientIds = new Set<number>();
    ws.on("close", () => {
      room.peers.delete(ws);
      const clientIds = [...awarenessClientIds];
      const clientClocks = clientIds.map(
        (clientId) => (room.awareness.meta.get(clientId)?.clock ?? 0) + 1,
      );
      awarenessProtocol.removeAwarenessStates(room.awareness, clientIds, null);
      if (clientIds.length > 0) {
        const awarenessEncoder = encoding.createEncoder();
        encoding.writeVarUint(awarenessEncoder, clientIds.length);
        clientIds.forEach((clientId, index) => {
          encoding.writeVarUint(awarenessEncoder, clientId);
          encoding.writeVarUint(awarenessEncoder, clientClocks[index]);
          encoding.writeVarString(awarenessEncoder, "null");
        });
        const awarenessUpdate = encoding.toUint8Array(awarenessEncoder);
        const awarenessMessage = encoding.createEncoder();
        encoding.writeVarUint(awarenessMessage, AWARENESS);
        encoding.writeVarUint8Array(awarenessMessage, awarenessUpdate);
        broadcast(room, encoding.toUint8Array(awarenessMessage));
      }
      if (room.peers.size === 0) {
        void snapshot(room.noteId, room.doc)
          .catch((error: unknown) => {
            console.error("Failed to snapshot room", error);
          })
          .finally(() => {
            if (room.snapshotTimer) {
              clearTimeout(room.snapshotTimer);
            }
            if (room.peers.size === 0 && rooms.get(room.noteId) === room) {
              rooms.delete(room.noteId);
            }
          });
      }
    });
  });
}
