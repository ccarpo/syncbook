import type { Server } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import * as Y from "yjs";
import * as sync from "y-protocols/sync";
import * as awareness from "y-protocols/awareness";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";
import { userIdFromToken } from "./auth.js";
import { ownedNote, loadDoc, appendUpdate, snapshot } from "./store.js";
const SYNC = 0, AWARENESS = 1;
type Peer = { ws: WebSocket; doc: Y.Doc; awareness: awareness.Awareness; noteId: string };
export function attachWs(server: Server): void {
  const wss = new WebSocketServer({ noServer: true }); const peers = new Set<Peer>();
  server.on("upgrade", async (req, socket, head) => {
    const url = new URL(req.url ?? "/", "http://localhost"), noteId = url.searchParams.get("noteId") ?? url.pathname.replace(/^\/ws\//, ""), uid = userIdFromToken(url.searchParams.get("token") ?? undefined);
    if (!noteId || !uid || !(await ownedNote(noteId, uid))) { socket.write("HTTP/1.1 401 Unauthorized\\r\\n\\r\\n"); socket.destroy(); return; }
    const doc = await loadDoc(noteId);
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, noteId, doc));
  });
  wss.on("connection", (ws: WebSocket, noteId: string, doc: Y.Doc) => {
    const peer: Peer = { ws, doc, awareness: new awareness.Awareness(doc), noteId }; peers.add(peer);
    const sendSync = (): void => { const enc = encoding.createEncoder(); encoding.writeVarUint(enc, SYNC); sync.writeSyncStep1(enc, doc); ws.send(encoding.toUint8Array(enc)); };
    sendSync();
    let snapshotTimer: ReturnType<typeof setTimeout> | undefined;
    let lastSnapshot = 0;
    const scheduleSnapshot = (): void => {
      if (snapshotTimer) clearTimeout(snapshotTimer);
      snapshotTimer = setTimeout(() => {
        if (Date.now() - lastSnapshot >= 10_000) {
          void snapshot(noteId); lastSnapshot = Date.now();
        }
      }, 3_000);
    };
    ws.on("message", async (data: Buffer) => {
      const dec = decoding.createDecoder(new Uint8Array(data)), type = decoding.readVarUint(dec);
      if (type === SYNC) {
        const inspect = decoding.createDecoder(new Uint8Array(data)); decoding.readVarUint(inspect);
        const syncType = decoding.readVarUint(inspect);
        if (syncType === 2) {
          const update = decoding.readVarUint8Array(inspect);
          void appendUpdate(noteId, update).then(scheduleSnapshot).catch((error: unknown) => console.error("Failed to persist update", error));
        }
        const enc = encoding.createEncoder(); encoding.writeVarUint(enc, SYNC); sync.readSyncMessage(dec, enc, doc, null); if (encoding.length(enc) > 1) ws.send(encoding.toUint8Array(enc)); broadcast(peer, data);
      }
      else if (type === AWARENESS) { awareness.applyAwarenessUpdate(peer.awareness, decoding.readVarUint8Array(dec), ws); broadcast(peer, data); }
    });
    ws.on("close", () => { if (snapshotTimer) clearTimeout(snapshotTimer); peers.delete(peer); awareness.removeAwarenessStates(peer.awareness, [peer.awareness.clientID], null); });
    function broadcast(source: Peer, message: Buffer): void { for (const p of peers) if (p !== source && p.noteId === source.noteId && p.ws.readyState === WebSocket.OPEN) p.ws.send(message); }
  });
}
