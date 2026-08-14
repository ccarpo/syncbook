import { useEffect, useMemo, useState, type ReactElement } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Collaboration from "@tiptap/extension-collaboration";
import * as Y from "yjs";
import { api } from "./api";
import type { Note, Snapshot } from "./types";
export function HistoryPanel({
  note,
  onRestore,
}: {
  note: Note;
  onRestore: () => void;
}): ReactElement {
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [preview, setPreview] = useState<Snapshot | null>(null);
  useEffect(() => {
    let active = true;
    const load = async (): Promise<void> => {
      const next = await api<Snapshot[]>(`/notes/${note.id}/history`);
      if (active) {
        setSnapshots(next);
      }
    };
    void load();
    const timer = setInterval(() => void load(), 3000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [note.id]);
  async function open(snapshot: Snapshot): Promise<void> {
    setPreview(await api<Snapshot>(`/notes/${note.id}/history/${snapshot.id}`));
  }
  async function restore(): Promise<void> {
    if (preview) {
      await api(`/notes/${note.id}/history/${preview.id}/restore`, { method: "POST" });
      const next = await api<Snapshot[]>(`/notes/${note.id}/history`);
      setSnapshots(next);
      onRestore();
    }
  }
  const previewDoc = useMemo(() => {
    const doc = new Y.Doc();
    if (preview?.state) {
      const bytes = Uint8Array.from(atob(preview.state), (char) => char.charCodeAt(0));
      Y.applyUpdate(doc, bytes);
    }
    return doc;
  }, [preview]);
  const previewEditor = useEditor(
    {
      editable: false,
      extensions: [
        StarterKit.configure({ history: false }),
        TaskList,
        TaskItem.configure({ nested: true }),
        Collaboration.configure({
          document: previewDoc,
          field: "prosemirror",
        }),
      ],
      editorProps: { attributes: { class: "editor history-editor" } },
    },
    [previewDoc],
  );
  return (
    <section className="history">
      <h2>History</h2>
      {snapshots.map((snapshot) => (
        <button key={snapshot.id} onClick={() => void open(snapshot)}>
          {new Date(snapshot.created_at).toLocaleString()} —{" "}
          {snapshot.excerpt || "Empty note"}
        </button>
      ))}
      {preview && (
        <div className="history-preview">
          {previewEditor ? (
            <EditorContent editor={previewEditor} />
          ) : (
            <p>{preview.excerpt || "Empty note"}</p>
          )}
          <button onClick={() => void restore()}>Restore this version</button>
        </div>
      )}
    </section>
  );
}
