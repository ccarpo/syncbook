import { useEffect, useRef, useState, type ReactElement } from "react";
import type { Note } from "./types";
import { ChangePassword } from "./ChangePassword";
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
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const handleClick = (event: MouseEvent): void => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [menuOpen]);

  const visible = notes.filter((note) => !tagFilter || note.tags.includes(tagFilter));
  return (
    <aside>
      <header>
        <h1>Syncbook</h1>
        <div className="header-actions">
          <button onClick={onCreate}>＋</button>
          <div className="burger-menu" ref={menuRef}>
            <button
              className="burger-button"
              aria-label="Menu"
              onClick={() => setMenuOpen((current) => !current)}
            >
              ☰
            </button>
            {menuOpen && (
              <div className="burger-dropdown">
                <ChangePassword />
                <button
                  onClick={() => {
                    setMenuOpen(false);
                    onLogout();
                  }}
                >
                  Log out
                </button>
              </div>
            )}
          </div>
        </div>
      </header>
      <div className="list-actions">
        <button onClick={onToggleTrash}>{trash ? "Notes" : "Trash"}</button>
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
          {selected?.id === note.id && note.owned && !trash && (
            <button
              className="note-delete"
              aria-label="Delete selected note"
              onClick={(event) => {
                event.stopPropagation();
                onDelete();
              }}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M3 6h18" />
                <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
                <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
              </svg>
            </button>
          )}
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
    </aside>
  );
}
