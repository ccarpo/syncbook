import * as Y from "yjs";
import { query, tx } from "./db.js";
import { applyUpdates, metadata } from "./doc.js";
export async function ownedNote(noteId: string, userId: string): Promise<boolean> {
  const rows = await query("SELECT id FROM notes WHERE id=$1 AND owner_id=$2", [noteId, userId]); return rows.length > 0;
}
export async function loadDoc(noteId: string): Promise<Y.Doc> {
  const snapshots = await query<{ state: Buffer }>("SELECT state FROM note_snapshots WHERE note_id=$1 ORDER BY created_at DESC LIMIT 1", [noteId]);
  const state = snapshots[0]?.state ?? null;
  const updates = await query<{ update: Buffer }>("SELECT \"update\" FROM note_updates WHERE note_id=$1 AND seq > COALESCE((SELECT max(seq) FROM note_updates WHERE note_id=$1 AND created_at <= (SELECT created_at FROM note_snapshots WHERE note_id=$1 ORDER BY created_at DESC LIMIT 1)),0) ORDER BY seq", [noteId]);
  return applyUpdates(state, updates.map((r) => new Uint8Array(r.update)));
}
export async function appendUpdate(noteId: string, update: Uint8Array): Promise<void> {
  await tx(async (c) => { await c.query("INSERT INTO note_updates(note_id, \"update\") VALUES($1,$2)", [noteId, Buffer.from(update)]); const doc = await loadDoc(noteId); const m = metadata(doc); await c.query("UPDATE notes SET title=$2, excerpt=$3, updated_at=now() WHERE id=$1", [noteId, m.title, m.excerpt]); });
}
export async function snapshot(noteId: string): Promise<void> {
  const doc = await loadDoc(noteId); const m = metadata(doc); await query("INSERT INTO note_snapshots(note_id,state,excerpt) VALUES($1,$2,$3)", [noteId, Buffer.from(Y.encodeStateAsUpdate(doc)), m.excerpt]);
}
export async function createNote(ownerId: string): Promise<Record<string, unknown>> { const rows = await query("INSERT INTO notes(owner_id) VALUES($1) RETURNING id,title,excerpt,updated_at,deleted_at", [ownerId]); return rows[0]; }
