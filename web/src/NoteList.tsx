import type { ReactElement } from "react";
import type { Note } from "./types";
export function NoteList({
  notes,
  selected,
  search,
  onSearch,
  tagFilter,
  onTagFilter,
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
  tagFilter: string;
  onTagFilter: (value: string) => void;
  onSelect: (note: Note) => void;
  onCreate: () => void;
  trash: boolean;
  onToggleTrash: () => void;
  onDelete: () => void;
  onRestore: (note: Note) => void;
  onLogout: () => void;
}): ReactElement {
  const visible = notes.filter(
    (note) =>
      `${note.title} ${note.excerpt} ${note.tags.join(" ")}`
        .toLowerCase()
        .includes(search.toLowerCase()) &&
      (!tagFilter || note.tags.includes(tagFilter)),
  );
  return (
    <aside>
      <header>
        <h1>Syncbook</h1>
        <button onClick={onCreate}>＋</button>
      </header>
      <div className="list-actions">
        <button onClick={onToggleTrash}>{trash ? "Notes" : "Trash"}</button>
        <button onClick={onLogout}>Log out</button>
      </div>
      <input
        value={search}
        onChange={(event) => onSearch(event.target.value)}
        placeholder="Search notes"
      />
      {tagFilter && (
        <button className="tag-filter-clear" onClick={() => onTagFilter("")}>
          Clear tag filter: #{tagFilter}
        </button>
      )}
      {visible.map((note) => (
        <div
          className={`note ${selected?.id === note.id ? "active" : ""}`}
          key={note.id}
          onClick={() => onSelect(note)}
          role="button"
          tabIndex={0}
        >
          <b>{note.title || "Untitled note"}</b>
          {!note.owned && (
            <small className="shared-badge">shared by {note.owner_email}</small>
          )}
          <small>{note.excerpt || "Empty note"}</small>
          {note.tags.length > 0 && (
            <div className="note-tags">
              {note.tags.map((tag) => (
                <button
                  className={`tag-chip ${tag === tagFilter ? "selected" : ""}`}
                  key={tag}
                  onClick={(event) => {
                    event.stopPropagation();
                    onTagFilter(tag === tagFilter ? "" : tag);
                  }}
                >
                  #{tag}
                </button>
              ))}
            </div>
          )}
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
      {!trash && selected?.owned && (
        <button className="delete-note" onClick={onDelete}>
          Delete selected note
        </button>
      )}
    </aside>
  );
}
