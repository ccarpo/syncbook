import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCursor from "@tiptap/extension-collaboration-cursor";
import * as Y from "yjs";
import { IndexeddbPersistence } from "y-indexeddb";
import { WebsocketProvider } from "y-websocket";
import { HistoryPanel } from "./HistoryPanel";
import type { Note, User } from "./types";
const CURSOR_COLORS = ["#3f5dce", "#d15b47", "#2f8f6b", "#a35bb8", "#c58a25"];
function colorForUser(id: string): string {
  let hash = 0;
  for (const character of id) {
    hash = (hash * 31 + character.charCodeAt(0)) | 0;
  }
  return CURSOR_COLORS[Math.abs(hash) % CURSOR_COLORS.length];
}
export function Editor({
  note,
  token,
  user,
  onChanged,
}: {
  note: Note;
  token: string;
  user: User;
  onChanged: () => void;
}): ReactElement {
  const [status, setStatus] = useState("connecting");
  const [showHistory, setShowHistory] = useState(false);
  const [presence, setPresence] = useState<Array<{ name: string; color: string }>>([]);
  const onChangedRef = useRef(onChanged);
  onChangedRef.current = onChanged;
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
        { disableBc: true, params: { token } },
      ),
    [note.id, token, ydoc],
  );
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ history: false }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Collaboration.configure({ document: ydoc, field: "prosemirror" }),
      CollaborationCursor.configure({
        provider,
        user: { name: user.email, color: colorForUser(user.id) },
      }),
    ],
    editorProps: { attributes: { class: "editor" } },
  });
  useEffect(() => {
    const handleStatus = ({ status: connection }: { status: string }): void =>
      setStatus(connection === "connected" ? "saving" : "offline");
    provider.on("status", handleStatus);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const observer = (): void => {
      if (timer) {
        clearTimeout(timer);
      }
      timer = setTimeout(() => onChangedRef.current(), 250);
    };
    ydoc.on("update", observer);
    return () => {
      provider.off("status", handleStatus);
      ydoc.off("update", observer);
      if (timer) {
        clearTimeout(timer);
      }
      persistence.destroy();
      provider.destroy();
      editor?.destroy();
    };
  }, [editor, persistence, provider, ydoc]);
  useEffect(() => {
    const updatePresence = (): void => {
      const others = [...provider.awareness.getStates().entries()]
        .filter(([clientId]) => clientId !== provider.awareness.clientID)
        .map(([, state]) => state.user as { name?: string; color?: string } | undefined)
        .filter((person): person is { name: string; color: string } =>
          Boolean(person?.name && person.color),
        );
      setPresence(others);
    };
    provider.awareness.on("change", updatePresence);
    updatePresence();
    return () => {
      provider.awareness.off("change", updatePresence);
    };
  }, [provider]);
  return (
    <section className="editor-pane">
      <div className="editor-header">
        <strong>{note.title || "Untitled note"}</strong>
        <span>{status}</span>
        <div className="presence" aria-label="People in this note">
          {presence.map((person, index) => (
            <span className="presence-person" key={`${person.name}-${index}`}>
              <i style={{ backgroundColor: person.color }} />
              {person.name}
            </span>
          ))}
        </div>
        <button onClick={() => editor?.chain().focus().toggleTaskList().run()}>
          Checklist
        </button>
        <button onClick={() => setShowHistory(!showHistory)}>History</button>
      </div>
      <EditorContent editor={editor} />
      {showHistory && <HistoryPanel note={note} onRestore={onChanged} />}
    </section>
  );
}
