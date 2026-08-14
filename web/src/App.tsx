import { useEffect, useState, type ReactElement } from "react";
import { api } from "./api";
import { Editor } from "./Editor";
import { Login } from "./Login";
import { NoteList } from "./NoteList";
import type { Note } from "./types";
export function App(): ReactElement {
  const [loggedIn, setLoggedIn] = useState(Boolean(localStorage.getItem("token")));
  const [notes, setNotes] = useState<Note[]>([]);
  const [selected, setSelected] = useState<Note | null>(null);
  const [search, setSearch] = useState("");
  async function load(): Promise<void> {
    const list = await api<Note[]>("/notes");
    setNotes(list);
    setSelected((current) => current ?? list[0] ?? null);
  }
  useEffect(() => {
    if (loggedIn) void load();
  }, [loggedIn]);
  if (!loggedIn) return <Login onLogin={() => setLoggedIn(true)} />;
  async function create(): Promise<void> {
    const note = await api<Note>("/notes", { method: "POST" });
    setNotes((current) => [note, ...current]);
    setSelected(note);
  }
  return (
    <main className="app">
      <NoteList
        notes={notes}
        selected={selected}
        search={search}
        onSearch={setSearch}
        onSelect={setSelected}
        onCreate={() => void create()}
      />
      {selected ? (
        <Editor
          note={selected}
          token={localStorage.getItem("token") ?? ""}
          onChanged={() => void load()}
        />
      ) : (
        <div className="empty">Create a note to get started.</div>
      )}
    </main>
  );
}
