import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import * as Y from "yjs";
import { migrate, pool, query } from "../src/db.js";
import {
  appendUpdate,
  COMPACTION_THRESHOLD,
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

  it("preserves block boundaries for titles, excerpts, and checklists", async () => {
    const note = await createNote(ownerId);
    const doc = new Y.Doc();
    const fragment = doc.getXmlFragment("prosemirror");
    const first = new Y.XmlElement("paragraph");
    first.insert(0, [new Y.XmlText("First block")]);
    const second = new Y.XmlElement("paragraph");
    second.insert(0, [new Y.XmlText("Second block")]);
    const checklist = new Y.XmlElement("taskItem");
    checklist.insert(0, [new Y.XmlText("Check this")]);
    fragment.insert(0, [first, second, checklist]);
    await appendUpdate(note.id, Y.encodeStateAsUpdate(doc), doc);

    const rows = await query<{ title: string; excerpt: string }>(
      "SELECT title, excerpt FROM notes WHERE id=$1",
      [note.id],
    );
    expect(rows[0]).toEqual({
      title: "First block",
      excerpt: "First block\nSecond block\nCheck this",
    });
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

  it("advances updated_at when metadata stays unchanged", async () => {
    const note = await createNote(ownerId);
    const doc = new Y.Doc();
    const fragment = doc.getXmlFragment("prosemirror");
    const first = new Y.XmlElement("paragraph");
    first.insert(0, [new Y.XmlText("Stable title")]);
    const second = new Y.XmlElement("paragraph");
    second.insert(0, [new Y.XmlText("x".repeat(250))]);
    fragment.insert(0, [first, second]);
    await appendUpdate(note.id, Y.encodeStateAsUpdate(doc), doc);

    const before = await query<{
      title: string;
      excerpt: string;
      updated_epoch: number;
    }>(
      "SELECT title, excerpt, EXTRACT(EPOCH FROM updated_at)::double precision AS updated_epoch FROM notes WHERE id=$1",
      [note.id],
    );
    const third = new Y.XmlElement("paragraph");
    third.insert(0, [new Y.XmlText("Later content")]);
    fragment.insert(2, [third]);
    await query("SELECT pg_sleep(0.02)");
    await appendUpdate(note.id, Y.encodeStateAsUpdate(doc), doc);

    const after = await query<{
      title: string;
      excerpt: string;
      updated_epoch: number;
    }>(
      "SELECT title, excerpt, EXTRACT(EPOCH FROM updated_at)::double precision AS updated_epoch FROM notes WHERE id=$1",
      [note.id],
    );
    expect(after[0]?.title).toBe(before[0]?.title);
    expect(after[0]?.excerpt).toBe(before[0]?.excerpt);
    expect(after[0]?.updated_epoch).toBeGreaterThan(before[0]?.updated_epoch ?? 0);
  });

  it("compacts update history without changing document content", async () => {
    const note = await createNote(ownerId);
    const doc = new Y.Doc();
    const text = doc.getText("content");
    for (let index = 0; index < COMPACTION_THRESHOLD; index += 1) {
      const before = Y.encodeStateVector(doc);
      text.insert(index, "x");
      await appendUpdate(note.id, Y.encodeStateAsUpdate(doc, before), doc);
    }
    await compactIfNeeded(note.id, doc, COMPACTION_THRESHOLD);
    const rows = await query<{ count: string }>(
      "SELECT count(*) FROM note_updates WHERE note_id=$1",
      [note.id],
    );
    expect(Number(rows[0].count)).toBe(0);
    expect((await loadDoc(note.id)).getText("content").toString()).toHaveLength(300);
  });
});
