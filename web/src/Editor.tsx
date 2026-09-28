import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type ReactElement,
} from "react";
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

const CODE_LANGUAGES = [
  { label: "auto", value: "" },
  { label: "JS", value: "javascript" },
  { label: "TS", value: "typescript" },
  { label: "Python", value: "python" },
  { label: "HTML", value: "html" },
  { label: "CSS", value: "css" },
  { label: "SQL", value: "sql" },
  { label: "JSON", value: "json" },
  { label: "Shell", value: "bash" },
];

function colorForUser(id: string): string {
  let hash = 0;
  for (const character of id) {
    hash = (hash * 31 + character.charCodeAt(0)) | 0;
  }
  return CURSOR_COLORS[Math.abs(hash) % CURSOR_COLORS.length];
}

function insertImageFromFile(editor: TiptapEditor | null, file: File): void {
  if (!editor || !file.type.startsWith("image/")) return;
  const reader = new FileReader();
  reader.onload = () => {
    const src = reader.result;
    if (typeof src === "string") {
      editor.chain().focus().setImage({ src }).run();
    }
  };
  reader.readAsDataURL(file);
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
      Image.configure({ inline: false, allowBase64: true }),
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
    editorProps: {
      attributes: { class: "editor" },
      handleClick(_view, _pos, event: MouseEvent) {
        const target = event.target as HTMLElement;
        const link = target.closest("a");
        if (link && (event.ctrlKey || event.metaKey)) {
          const href = link.getAttribute("href");
          if (href) window.open(href, "_blank", "noopener,noreferrer");
          return true;
        }
        return false;
      },
      handleDrop(_view, event: DragEvent, slice, moved: boolean) {
        void slice;
        if (moved) return false;
        const files = event.dataTransfer?.files;
        if (!files || files.length === 0) return false;
        const file = files[0];
        if (file.type.startsWith("image/")) {
          event.preventDefault();
          insertImageFromFile(editorRef.current, file);
          return true;
        }
        return false;
      },
      handlePaste(_view, event: ClipboardEvent, slice) {
        void slice;
        const items = event.clipboardData?.items;
        if (!items) return false;
        for (const item of items) {
          if (item.type.startsWith("image/")) {
            const file = item.getAsFile();
            if (file) {
              event.preventDefault();
              insertImageFromFile(editorRef.current, file);
              return true;
            }
          }
        }
        return false;
      },
    },
  });

  const editorRef = useRef(editor);
  useEffect(() => {
    editorRef.current = editor;
  }, [editor]);

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
          <AddTagChip onAdd={(tag) => void saveTags([...tags, tag])} />
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

function AddTagChip({ onAdd }: { onAdd: (tag: string) => void }): ReactElement {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
    }
  }, [open]);

  const commit = (): void => {
    const next = value.trim();
    if (next) {
      const newTags = next
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean);
      for (const tag of newTags) {
        onAdd(tag);
      }
    }
    setValue("");
    setOpen(false);
  };

  if (open) {
    return (
      <span className="tag-chip add-tag">
        #
        <input
          ref={inputRef}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === ",") {
              event.preventDefault();
              commit();
            }
            if (event.key === "Escape") {
              setValue("");
              setOpen(false);
            }
          }}
          onBlur={commit}
          placeholder="tag"
        />
      </span>
    );
  }

  return (
    <button
      className="tag-chip add-tag"
      onClick={() => setOpen(true)}
      aria-label="Add tag"
    >
      + Tag
    </button>
  );
}

function LinkDialog({
  editor,
  open,
  onClose,
}: {
  editor: TiptapEditor;
  open: boolean;
  onClose: () => void;
}): ReactElement {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState("https://");

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open) {
      setUrl("https://");
      if (!dialog.open) {
        dialog.showModal();
        setTimeout(() => inputRef.current?.focus(), 0);
      }
    } else if (dialog.open) {
      dialog.close();
    }
  }, [open]);

  const apply = (event?: FormEvent): void => {
    event?.preventDefault();
    const href = url.trim();
    if (!href || href === "https://") {
      onClose();
      return;
    }
    if (editor.state.selection.empty) {
      editor
        .chain()
        .focus()
        .insertContent({
          type: "text",
          text: href,
          marks: [{ type: "link", attrs: { href } }],
        })
        .run();
    } else {
      editor.chain().focus().setLink({ href }).run();
    }
    onClose();
  };

  return (
    <dialog ref={dialogRef} className="link-dialog" onClose={onClose}>
      <form onSubmit={apply}>
        <label>
          Link URL
          <input
            ref={inputRef}
            type="url"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://example.com"
          />
        </label>
        <div className="link-dialog-actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit">Apply</button>
        </div>
      </form>
    </dialog>
  );
}

function TableMenu({ editor }: { editor: TiptapEditor }): ReactElement {
  const [key, setKey] = useState(0);
  const active = editor.isActive("table");

  const run = (command: () => void): void => {
    command();
    setKey((previous) => previous + 1);
  };

  return (
    <select
      key={key}
      className="table-menu"
      value=""
      onChange={(event) => {
        const action = event.target.value;
        event.target.value = "";
        switch (action) {
          case "insert":
            run(() =>
              editor
                .chain()
                .focus()
                .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
                .run(),
            );
            break;
          case "addRowBefore":
            run(() => editor.chain().focus().addRowBefore().run());
            break;
          case "addRowAfter":
            run(() => editor.chain().focus().addRowAfter().run());
            break;
          case "deleteRow":
            run(() => editor.chain().focus().deleteRow().run());
            break;
          case "addColumnBefore":
            run(() => editor.chain().focus().addColumnBefore().run());
            break;
          case "addColumnAfter":
            run(() => editor.chain().focus().addColumnAfter().run());
            break;
          case "deleteColumn":
            run(() => editor.chain().focus().deleteColumn().run());
            break;
          case "deleteTable":
            run(() => editor.chain().focus().deleteTable().run());
            break;
          case "toggleHeaderRow":
            run(() => editor.chain().focus().toggleHeaderRow().run());
            break;
          default:
        }
      }}
      aria-label="Table"
    >
      <option value="" disabled>
        Table
      </option>
      <option value="insert">Insert table</option>
      {active && (
        <>
          <option value="addRowBefore">Add row before</option>
          <option value="addRowAfter">Add row after</option>
          <option value="deleteRow">Delete row</option>
          <option value="addColumnBefore">Add column before</option>
          <option value="addColumnAfter">Add column after</option>
          <option value="deleteColumn">Delete column</option>
          <option value="toggleHeaderRow">Toggle header row</option>
          <option value="deleteTable">Delete table</option>
        </>
      )}
    </select>
  );
}

function CodeBlockControl({ editor }: { editor: TiptapEditor }): ReactElement {
  const active = editor.isActive("codeBlock");
  const language =
    (editor.getAttributes("codeBlock").language as string | undefined) ?? "";

  const setLanguage = (value: string): void => {
    const next = value || null;
    if (active) {
      editor.chain().focus().updateAttributes("codeBlock", { language: next }).run();
    } else if (value) {
      editor.chain().focus().setCodeBlock({ language: value }).run();
    } else {
      editor.chain().focus().setCodeBlock().run();
    }
  };

  return (
    <span className="code-block-control" title="Code block language">
      <button
        type="button"
        aria-label="Code block"
        className={active ? "active" : undefined}
        onClick={() => editor.chain().focus().toggleCodeBlock().run()}
      >
        {"</>"}
      </button>
      <select
        value={language}
        onChange={(event) => setLanguage(event.target.value)}
        aria-label="Code language"
      >
        {CODE_LANGUAGES.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </span>
  );
}

function Toolbar({ editor }: { editor: TiptapEditor }): ReactElement {
  const [linkOpen, setLinkOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleImageSelect = (event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0];
    if (file) {
      insertImageFromFile(editor, file);
    }
    event.target.value = "";
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
      <CodeBlockControl editor={editor} />
      <button
        type="button"
        aria-label="Link"
        className={editor.isActive("link") ? "active" : undefined}
        onClick={() => {
          if (editor.isActive("link")) {
            editor.chain().focus().unsetLink().run();
          } else {
            setLinkOpen(true);
          }
        }}
      >
        Link
      </button>
      <LinkDialog editor={editor} open={linkOpen} onClose={() => setLinkOpen(false)} />
      <button
        type="button"
        aria-label="Image"
        onClick={() => fileInputRef.current?.click()}
      >
        Img
      </button>
      <input
        type="file"
        accept="image/*"
        ref={fileInputRef}
        onChange={handleImageSelect}
        hidden
      />
      <TableMenu editor={editor} />
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
