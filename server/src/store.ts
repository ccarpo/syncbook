import * as Y from "yjs";
import { notifyUserEvent, query, tx } from "./db.js";
import { applyUpdates, metadata } from "./doc.js";

export const COMPACTION_THRESHOLD = 300;

export type NoteRow = {
  id: string;
  title: string;
  excerpt: string;
  updated_at: string;
  deleted_at: string | null;
  tags: string[];
  owned: boolean;
  owner_email: string;
};

export async function ownedNote(noteId: string, userId: string): Promise<boolean> {
  const rows = await query("SELECT id FROM notes WHERE id=$1 AND owner_id=$2", [
    noteId,
    userId,
  ]);
  return rows.length > 0;
}

export async function noteAccess(
  noteId: string,
  userId: string,
): Promise<"owner" | "shared" | null> {
  const rows = await query<{ access: "owner" | "shared" }>(
    `SELECT CASE WHEN owner_id=$2 THEN 'owner' ELSE 'shared' END AS access
     FROM notes
     WHERE id=$1
       AND (owner_id=$2 OR EXISTS (
         SELECT 1 FROM note_shares WHERE note_id=notes.id AND user_id=$2
       ))`,
    [noteId, userId],
  );
  return rows[0]?.access ?? null;
}

export async function participants(noteId: string): Promise<string[]> {
  const rows = await query<{ user_id: string }>(
    `SELECT owner_id AS user_id FROM notes WHERE id=$1
     UNION
     SELECT user_id FROM note_shares WHERE note_id=$1`,
    [noteId],
  );
  return rows.map((row) => row.user_id);
}

async function notifyParticipants(
  noteId: string,
  additional: string[] = [],
): Promise<void> {
  const users = new Set([...((await participants(noteId)) ?? []), ...additional]);
  await Promise.all(
    [...users].map((userId) =>
      notifyUserEvent(userId, "notes-changed").catch((error: unknown) => {
        console.error("Failed to publish note event", error);
      }),
    ),
  );
}

export async function loadDoc(noteId: string): Promise<Y.Doc> {
  const snapshots = await query<{ state: Buffer; up_to_seq: string | null }>(
    "SELECT state, up_to_seq FROM note_snapshots WHERE note_id=$1 ORDER BY created_at DESC LIMIT 1",
    [noteId],
  );
  const state = snapshots[0]?.state ?? null;
  const watermark = snapshots[0]?.up_to_seq ?? "0";
  const updates = await query<{ update: Buffer }>(
    'SELECT "update" FROM note_updates WHERE note_id=$1 AND seq > $2 ORDER BY seq',
    [noteId, watermark],
  );
  return applyUpdates(
    state ? new Uint8Array(state) : null,
    updates.map((row) => new Uint8Array(row.update)),
  );
}

export async function appendUpdate(
  noteId: string,
  update: Uint8Array,
  doc: Y.Doc,
): Promise<void> {
  const noteMetadata = metadata(doc);
  const metadataChanged = await tx(async (client) => {
    await client.query('INSERT INTO note_updates(note_id, "update") VALUES($1,$2)', [
      noteId,
      Buffer.from(update),
    ]);
    const result = await client.query<{ id: string }>(
      `WITH previous AS (
         SELECT owner_id, title, excerpt
         FROM notes
         WHERE id=$1
       ),
       updated AS (
         UPDATE notes
         SET title=$2, excerpt=$3, updated_at=now()
         WHERE id=$1
         RETURNING id
       )
       SELECT updated.id
       FROM updated
       CROSS JOIN previous
       WHERE previous.title IS DISTINCT FROM $2
          OR previous.excerpt IS DISTINCT FROM $3`,
      [noteId, noteMetadata.title, noteMetadata.excerpt],
    );
    return result.rows.length > 0;
  });
  if (metadataChanged) {
    await notifyParticipants(noteId);
  }
}

export { notifyParticipants };

export async function snapshot(noteId: string, doc?: Y.Doc): Promise<void> {
  const current = doc ?? (await loadDoc(noteId));
  const noteMetadata = metadata(current);
  await tx(async (client) => {
    const result = await client.query<{ max: string | null }>(
      "SELECT max(seq) AS max FROM note_updates WHERE note_id=$1",
      [noteId],
    );
    await client.query(
      "INSERT INTO note_snapshots(note_id,state,excerpt,up_to_seq) VALUES($1,$2,$3,$4)",
      [
        noteId,
        Buffer.from(Y.encodeStateAsUpdate(current)),
        noteMetadata.excerpt,
        result.rows[0]?.max ?? 0,
      ],
    );
  });
}

export async function compactIfNeeded(
  noteId: string,
  doc: Y.Doc,
  updateCount: number,
): Promise<boolean> {
  if (updateCount < COMPACTION_THRESHOLD) {
    return false;
  }
  await snapshot(noteId, doc);
  await query(
    "DELETE FROM note_updates WHERE note_id=$1 AND seq <= (SELECT up_to_seq FROM note_snapshots WHERE note_id=$1 ORDER BY created_at DESC LIMIT 1)",
    [noteId],
  );
  return true;
}

export async function createNote(ownerId: string): Promise<NoteRow> {
  const rows = await query<Omit<NoteRow, "tags" | "owned" | "owner_email">>(
    "INSERT INTO notes(owner_id) VALUES($1) RETURNING id,title,excerpt,updated_at,deleted_at",
    [ownerId],
  );
  const owner = await query<{ email: string }>("SELECT email FROM users WHERE id=$1", [
    ownerId,
  ]);
  return {
    ...rows[0],
    tags: [],
    owned: true,
    owner_email: owner[0]?.email ?? "",
  };
}
