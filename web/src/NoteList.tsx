import type { ReactElement } from "react";
import type { Note } from "./types";
import { ChangePassword } from "./ChangePassword";
export function NoteList({
  notes,
  selected,
  search,
  onSearch,
  onSelect,
  onCreate,
  trash,
  onToggleTrash,
  onDelete,
  onRestore,
  onLogout,
}: {
  notes: Note[];
  selected: Note | null;
  search: string;
  onSearch: (value: string) => void;
  onSelect: (note: Note) => void;
  onCreate: () => void;
  trash: boolean;
  onToggleTrash: () => void;
  onDelete: () => void;
  onRestore: (note: Note) => void;
  onLogout: () => void;
}): ReactElement {
  const visible = notes.filter((note) =>
    `${note.title} ${note.excerpt}`.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <aside>
      <header>
        <h1>Syncbook</h1>
        <button onClick={onCreate}>＋</button>
      </header>
      <div className="list-actions">
        <button onClick={onToggleTrash}>{trash ? "Notes" : "Trash"}</button>
        <ChangePassword />
        <button onClick={onLogout}>Log out</button>
      </div>
      <input
        value={search}
        onChange={(event) => onSearch(event.target.value)}
        placeholder="Search notes"
      />
      {visible.map((note) => (
        <div
          className={`note ${selected?.id === note.id ? "active" : ""}`}
          key={note.id}
          onClick={() => onSelect(note)}
          role="button"
          tabIndex={0}
        >
          <b>{note.title || "Untitled note"}</b>
          <small>{note.excerpt || "Empty note"}</small>
          <time>{new Date(note.updated_at).toLocaleString()}</time>
          {trash && (
            <button
              className="restore-note"
              onClick={(event) => {
                event.stopPropagation();
                onRestore(note);
              }}
            >
              Restore
            </button>
          )}
        </div>
      ))}
      {!trash && selected && (
        <button className="delete-note" onClick={onDelete}>
          Delete selected note
        </button>
      )}
    </aside>
  );
}
