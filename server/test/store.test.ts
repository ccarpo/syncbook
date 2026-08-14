import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as Y from "yjs";
import { migrate, pool, query } from "../src/db.js";
import {
  appendUpdate,
  compactIfNeeded,
  createNote,
  loadDoc,
  snapshot,
} from "../src/store.js";

let ownerId = "";

beforeAll(async () => {
  await migrate();
  const rows = await query<{ id: string }>(
    "INSERT INTO users(email,password_hash) VALUES($1,$2) RETURNING id",
    [`test-${randomUUID()}@example.com`, "test-hash"],
  );
  ownerId = rows[0].id;
});

afterAll(async () => {
  await pool.end();
});

describe("Yjs persistence", () => {
  it("derives title and excerpt from an editor-shaped ProseMirror update", async () => {
    const note = await createNote(ownerId);
    const doc = new Y.Doc();
    const fragment = doc.getXmlFragment("prosemirror");
    const paragraph = new Y.XmlElement("paragraph");
    paragraph.insert(0, [new Y.XmlText("Editor title")]);
    fragment.insert(0, [paragraph]);
    await appendUpdate(note.id, Y.encodeStateAsUpdate(doc), doc);

    const rows = await query<{ title: string; excerpt: string }>(
      "SELECT title, excerpt FROM notes WHERE id=$1",
      [note.id],
    );
    expect(rows[0]).toEqual({ title: "Editor title", excerpt: "Editor title" });
    expect(Y.encodeStateAsUpdate(await loadDoc(note.id)).byteLength).toBeGreaterThan(0);
  });

  it("records a sequence watermark and reloads from it", async () => {
    const note = await createNote(ownerId);
    const doc = new Y.Doc();
    const text = doc.getText("content");
    text.insert(0, "before");
    await appendUpdate(note.id, Y.encodeStateAsUpdate(doc), doc);
    await snapshot(note.id, doc);
    text.insert(6, " after");
    await appendUpdate(note.id, Y.encodeStateAsUpdate(doc), doc);

    const loaded = await loadDoc(note.id);
    expect(loaded.getText("content").toString()).toBe("before after");
  });

  it("compacts update history without changing document content", async () => {
    const note = await createNote(ownerId);
    const doc = new Y.Doc();
    const text = doc.getText("content");
    for (let index = 0; index < 300; index += 1) {
      const before = Y.encodeStateVector(doc);
      text.insert(index, "x");
      await appendUpdate(note.id, Y.encodeStateAsUpdate(doc, before), doc);
    }
    await compactIfNeeded(note.id, doc);
    const rows = await query<{ count: string }>(
      "SELECT count(*) FROM note_updates WHERE note_id=$1",
      [note.id],
    );
    expect(Number(rows[0].count)).toBe(0);
    expect((await loadDoc(note.id)).getText("content").toString()).toHaveLength(300);
  });
});
