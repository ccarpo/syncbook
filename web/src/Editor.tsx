import { useEffect, useMemo, useState, type ReactElement } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Collaboration from "@tiptap/extension-collaboration";
import * as Y from "yjs";
import { IndexeddbPersistence } from "y-indexeddb";
import { WebsocketProvider } from "y-websocket";
import { HistoryPanel } from "./HistoryPanel";
import type { Note } from "./types";
export function Editor({
  note,
  token,
  onChanged,
}: {
  note: Note;
  token: string;
  onChanged: () => void;
}): ReactElement {
  const [status, setStatus] = useState("connecting");
  const [showHistory, setShowHistory] = useState(false);
  const ydoc = useMemo(() => new Y.Doc(), [note.id]);
  const persistence = useMemo(
    () => new IndexeddbPersistence(`note-${note.id}`, ydoc),
    [note.id, ydoc],
  );
  const provider = useMemo(
    () =>
      new WebsocketProvider(
        `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`,
        note.id,
        ydoc,
        { params: { token } },
      ),
    [note.id, token, ydoc],
  );
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ history: false }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Collaboration.configure({ document: ydoc, field: "prosemirror" }),
    ],
    editorProps: { attributes: { class: "editor" } },
  });
  useEffect(() => {
    provider.on("status", ({ status: connection }: { status: string }) =>
      setStatus(connection === "connected" ? "saving" : "offline"),
    );
    const observer = (): void => onChanged();
    ydoc.on("update", observer);
    return () => {
      ydoc.off("update", observer);
      persistence.destroy();
      provider.destroy();
      editor?.destroy();
    };
  }, [editor, onChanged, persistence, provider, ydoc]);
  return (
    <section className="editor-pane">
      <div className="editor-header">
        <strong>{note.title || "Untitled note"}</strong>
        <span>{status}</span>
        <button onClick={() => setShowHistory(!showHistory)}>History</button>
      </div>
      <EditorContent editor={editor} />
      {showHistory && <HistoryPanel note={note} onRestore={onChanged} />}
    </section>
  );
}
