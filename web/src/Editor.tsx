import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import type { Editor as TiptapEditor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Link from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";
import Table from "@tiptap/extension-table";
import TableRow from "@tiptap/extension-table-row";
import TableHeader from "@tiptap/extension-table-header";
import TableCell from "@tiptap/extension-table-cell";
import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCursor from "@tiptap/extension-collaboration-cursor";
import * as Y from "yjs";
import { IndexeddbPersistence } from "y-indexeddb";
import { WebsocketProvider } from "y-websocket";
import { HistoryPanel } from "./HistoryPanel";
import { api } from "./api";
import type { Note, User } from "./types";
type Share = { user_id: string; email: string; created_at: string };
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
  const [tags, setTags] = useState(note.tags);
  const [tagInput, setTagInput] = useState("");
  const [showSharing, setShowSharing] = useState(false);
  const [shares, setShares] = useState<Share[]>([]);
  const [shareEmail, setShareEmail] = useState("");
  const [metaError, setMetaError] = useState("");
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
        { disableBc: true, resyncInterval: 20_000, params: { token } },
      ),
    [note.id, token, ydoc],
  );
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ history: false }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Link.configure({ autolink: true, linkOnPaste: true, openOnClick: false }),
      Image.configure({ inline: false, allowBase64: false }),
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
      Collaboration.configure({ document: ydoc, field: "prosemirror" }),
      CollaborationCursor.configure({
        provider,
        user: { name: user.email, color: colorForUser(user.id) },
      }),
    ],
    editorProps: { attributes: { class: "editor" } },
  });
  const noteTagsKey = note.tags.join("\u0000");
  useEffect(() => {
    setTags((current) => (current.join("\u0000") === noteTagsKey ? current : note.tags));
  }, [note.id, noteTagsKey]);
  useEffect(() => {
    const handleStatus = ({ status: connection }: { status: string }): void =>
      setStatus(connection === "connected" ? "saving" : "offline");
    provider.on("status", handleStatus);
    setStatus(provider.wsconnected ? "saving" : "connecting");
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
    };
  }, [provider, ydoc]);
  useEffect(
    () => () => {
      persistence.destroy();
      provider.destroy();
    },
    [persistence, provider],
  );
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
  async function saveTags(nextTags: string[]): Promise<boolean> {
    try {
      const result = await api<{ tags: string[] }>(`/notes/${note.id}/tags`, {
        method: "PUT",
        body: JSON.stringify({ tags: nextTags }),
      });
      setTags(result.tags);
      setMetaError("");
      onChangedRef.current();
      return true;
    } catch (cause) {
      setMetaError(cause instanceof Error ? cause.message : "Unable to update tags");
      return false;
    }
  }
  async function commitTagInput(): Promise<void> {
    const next = tagInput.trim();
    if (!next) {
      return;
    }
    if (await saveTags([...tags, ...next.split(",")])) {
      setTagInput("");
    }
  }
  async function loadShares(): Promise<void> {
    try {
      setShares(await api<Share[]>(`/notes/${note.id}/shares`));
      setMetaError("");
    } catch (cause) {
      setMetaError(cause instanceof Error ? cause.message : "Unable to load shares");
    }
  }
  async function addShare(): Promise<void> {
    try {
      await api<Share>(`/notes/${note.id}/shares`, {
        method: "POST",
        body: JSON.stringify({ email: shareEmail }),
      });
      setShareEmail("");
      await loadShares();
      onChangedRef.current();
    } catch (cause) {
      setMetaError(cause instanceof Error ? cause.message : "Unable to add share");
    }
  }
  async function removeShare(userId: string): Promise<void> {
    try {
      await api(`/notes/${note.id}/shares/${userId}`, { method: "DELETE" });
      await loadShares();
      onChangedRef.current();
    } catch (cause) {
      setMetaError(cause instanceof Error ? cause.message : "Unable to remove share");
    }
  }
  return (
    <section className="editor-pane">
      <div className="editor-header">
        <div className="editor-heading">
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
        </div>
        <div className="editor-actions">
          {note.owned && (
            <button
              onClick={() => {
                setShowSharing((current) => !current);
                if (!showSharing) void loadShares();
              }}
            >
              Share
            </button>
          )}
          <button onClick={() => editor?.chain().focus().toggleTaskList().run()}>
            Checklist
          </button>
          <button onClick={() => setShowHistory(!showHistory)}>History</button>
        </div>
      </div>
      <div className="editor-meta">
        <div className="tag-editor" aria-label="Note tags">
          {tags.map((tag) => (
            <span className="tag-chip" key={tag}>
              #{tag}
              <button
                aria-label={`Remove tag ${tag}`}
                onClick={() => void saveTags(tags.filter((current) => current !== tag))}
              >
                ×
              </button>
            </span>
          ))}
          <input
            value={tagInput}
            onChange={(event) => setTagInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === ",") {
                event.preventDefault();
                void commitTagInput();
              }
            }}
            placeholder="Add a tag"
          />
        </div>
        {showSharing && note.owned && (
          <div className="sharing-panel">
            <div className="share-list">
              {shares.map((share) => (
                <span className="share-person" key={share.user_id}>
                  {share.email}
                  <button onClick={() => void removeShare(share.user_id)}>Remove</button>
                </span>
              ))}
            </div>
            <div className="share-add">
              <input
                type="email"
                value={shareEmail}
                onChange={(event) => setShareEmail(event.target.value)}
                placeholder="Email to share with"
              />
              <button onClick={() => void addShare()}>Add</button>
            </div>
          </div>
        )}
        {metaError && (
          <p className="share-error" role="alert">
            {metaError}
          </p>
        )}
      </div>
      <div hidden={showHistory}>
        {editor && <Toolbar editor={editor} />}
        <EditorContent editor={editor} />
      </div>
      {showHistory && (
        <HistoryPanel
          note={note}
          onRestore={onChanged}
          onClose={() => setShowHistory(false)}
        />
      )}
    </section>
  );
}

function Toolbar({ editor }: { editor: TiptapEditor }): ReactElement {
  const addLink = (): void => {
    if (editor.isActive("link")) {
      editor.chain().focus().unsetLink().run();
      return;
    }
    const url = window.prompt("Enter link URL");
    if (!url) return;
    if (editor.state.selection.empty) {
      editor
        .chain()
        .focus()
        .insertContent({
          type: "text",
          text: url,
          marks: [{ type: "link", attrs: { href: url } }],
        })
        .run();
    } else {
      editor.chain().focus().setLink({ href: url }).run();
    }
  };

  const addImage = (): void => {
    const src = window.prompt("Enter image URL");
    if (src) editor.chain().focus().setImage({ src }).run();
  };

  const insertTable = (): void => {
    editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
  };

  return (
    <div className="editor-toolbar" aria-label="Formatting">
      <button
        type="button"
        aria-label="Bold"
        className={editor.isActive("bold") ? "active" : undefined}
        onClick={() => editor.chain().focus().toggleBold().run()}
      >
        B
      </button>
      <button
        type="button"
        aria-label="Italic"
        className={editor.isActive("italic") ? "active" : undefined}
        onClick={() => editor.chain().focus().toggleItalic().run()}
      >
        I
      </button>
      <button
        type="button"
        aria-label="Heading"
        className={editor.isActive("heading", { level: 2 }) ? "active" : undefined}
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
      >
        H
      </button>
      <button
        type="button"
        aria-label="Bullet list"
        className={editor.isActive("bulletList") ? "active" : undefined}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
      >
        •
      </button>
      <button
        type="button"
        aria-label="Numbered list"
        className={editor.isActive("orderedList") ? "active" : undefined}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
      >
        1.
      </button>
      <button
        type="button"
        aria-label="Quote"
        className={editor.isActive("blockquote") ? "active" : undefined}
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
      >
        ”
      </button>
      <button
        type="button"
        aria-label="Inline code"
        className={editor.isActive("code") ? "active" : undefined}
        onClick={() => editor.chain().focus().toggleCode().run()}
      >
        &lt;/&gt;
      </button>
      <button
        type="button"
        aria-label="Link"
        className={editor.isActive("link") ? "active" : undefined}
        onClick={addLink}
      >
        Link
      </button>
      <button type="button" aria-label="Image" onClick={addImage}>
        Img
      </button>
      <button type="button" aria-label="Table" onClick={insertTable}>
        Table
      </button>
      <button
        type="button"
        aria-label="Checklist"
        className={editor.isActive("taskList") ? "active" : undefined}
        onClick={() => editor.chain().focus().toggleTaskList().run()}
      >
        Check
      </button>
    </div>
  );
}
