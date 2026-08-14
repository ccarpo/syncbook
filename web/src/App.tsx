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
  const [trash, setTrash] = useState(false);
  async function load(showTrash = trash): Promise<void> {
    const list = await api<Note[]>(showTrash ? "/notes?trash=true" : "/notes");
    setNotes(list);
    setSelected((current) => current ?? list[0] ?? null);
  }
  useEffect(() => {
    if (loggedIn) void load();
  }, [loggedIn, trash]);
  if (!loggedIn) return <Login onLogin={() => setLoggedIn(true)} />;
  async function create(): Promise<void> {
    const note = await api<Note>("/notes", { method: "POST" });
    setNotes((current) => [note, ...current]);
    setSelected(note);
  }
  async function deleteSelected(): Promise<void> {
    if (!selected || !window.confirm("Delete this note?")) {
      return;
    }
    await api(`/notes/${selected.id}`, { method: "DELETE" });
    setSelected(null);
    await load();
  }
  async function restore(note: Note): Promise<void> {
    await api(`/notes/${note.id}/restore`, { method: "POST" });
    await load();
  }
  function logout(): void {
    localStorage.removeItem("token");
    setLoggedIn(false);
    setNotes([]);
    setSelected(null);
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
        trash={trash}
        onToggleTrash={() => {
          setTrash((current) => !current);
          setSelected(null);
        }}
        onDelete={() => void deleteSelected()}
        onRestore={(note) => void restore(note)}
        onLogout={logout}
      />
      {selected && !trash ? (
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
