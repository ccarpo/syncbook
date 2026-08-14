import type { ReactElement } from "react";
import type { Note } from "./types";
export function NoteList({
  notes,
  selected,
  search,
  onSearch,
  onSelect,
  onCreate,
}: {
  notes: Note[];
  selected: Note | null;
  search: string;
  onSearch: (value: string) => void;
  onSelect: (note: Note) => void;
  onCreate: () => void;
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
      <input
        value={search}
        onChange={(event) => onSearch(event.target.value)}
        placeholder="Search notes"
      />
      {visible.map((note) => (
        <button
          className={`note ${selected?.id === note.id ? "active" : ""}`}
          key={note.id}
          onClick={() => onSelect(note)}
        >
          <b>{note.title || "Untitled note"}</b>
          <small>{note.excerpt || "Empty note"}</small>
          <time>{new Date(note.updated_at).toLocaleString()}</time>
        </button>
      ))}
    </aside>
  );
}
