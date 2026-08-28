import { useEffect, useRef, useState, type ReactElement } from "react";
import { api } from "./api";
import { Editor } from "./Editor";
import { Login } from "./Login";
import { NoteList } from "./NoteList";
import type { Note, User } from "./types";
export function App(): ReactElement {
  const [loggedIn, setLoggedIn] = useState(Boolean(localStorage.getItem("token")));
  const [notes, setNotes] = useState<Note[]>([]);
  const [selected, setSelected] = useState<Note | null>(null);
  const [search, setSearch] = useState("");
  const [trash, setTrash] = useState(false);
  const [error, setError] = useState("");
  const [user, setUser] = useState<User | null>(null);
  const userSocket = useRef<WebSocket | null>(null);
  const notificationTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  async function load(showTrash = trash): Promise<void> {
    try {
      const list = await api<Note[]>(showTrash ? "/notes?trash=true" : "/notes");
      setNotes(list);
      setSelected(
        (current) => list.find((note) => note.id === current?.id) ?? list[0] ?? null,
      );
    } catch {
      return;
    }
  }
  useEffect(() => {
    if (loggedIn) {
      void api<{ user: User }>("/me").then((result) => setUser(result.user));
    } else {
      setUser(null);
    }
  }, [loggedIn]);
  useEffect(() => {
    if (loggedIn) void load();
  }, [loggedIn, trash]);
  useEffect(() => {
    const showError = (event: Event): void => {
      setError((event as CustomEvent<string>).detail || "Request failed");
    };
    const clearError = (): void => {
      setError("");
    };
    const expireSession = (): void => {
      localStorage.removeItem("token");
      setLoggedIn(false);
      setNotes([]);
      setSelected(null);
    };
    const handleStorage = (event: StorageEvent): void => {
      if (event.key === "token" && !event.newValue) {
        expireSession();
      }
    };
    window.addEventListener("syncbook-api-error", showError);
    window.addEventListener("syncbook-api-success", clearError);
    window.addEventListener("syncbook-session-expired", expireSession);
    window.addEventListener("storage", handleStorage);
    return () => {
      window.removeEventListener("syncbook-api-error", showError);
      window.removeEventListener("syncbook-api-success", clearError);
      window.removeEventListener("syncbook-session-expired", expireSession);
      window.removeEventListener("storage", handleStorage);
    };
  }, []);
  useEffect(() => {
    if (!loggedIn) {
      userSocket.current?.close();
      userSocket.current = null;
      return;
    }
    const token = localStorage.getItem("token");
    if (!token) {
      setLoggedIn(false);
      return;
    }
    const socket = new WebSocket(
      `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws/user?token=${encodeURIComponent(token)}`,
    );
    userSocket.current = socket;
    socket.onmessage = () => {
      if (notificationTimer.current) {
        clearTimeout(notificationTimer.current);
      }
      notificationTimer.current = setTimeout(() => {
        void load();
      }, 250);
    };
    socket.onerror = () => {
      setError("Live note updates are unavailable");
    };
    return () => {
      socket.close();
      if (notificationTimer.current) {
        clearTimeout(notificationTimer.current);
      }
      if (userSocket.current === socket) {
        userSocket.current = null;
      }
    };
  }, [loggedIn]);
  if (!loggedIn) return <Login onLogin={() => setLoggedIn(true)} />;
  async function create(): Promise<void> {
    try {
      const note = await api<Note>("/notes", { method: "POST" });
      setNotes((current) => [note, ...current]);
      setSelected(note);
    } catch {
      return;
    }
  }
  async function deleteSelected(): Promise<void> {
    if (!selected || !window.confirm("Delete this note?")) {
      return;
    }
    try {
      await api(`/notes/${selected.id}`, { method: "DELETE" });
      setSelected(null);
      await load();
    } catch {
      return;
    }
  }
  async function restore(note: Note): Promise<void> {
    try {
      await api(`/notes/${note.id}/restore`, { method: "POST" });
      await load();
    } catch {
      return;
    }
  }
  function logout(): void {
    localStorage.removeItem("token");
    setLoggedIn(false);
    setNotes([]);
    setSelected(null);
  }
  return (
    <main className="app">
      {error && (
        <div className="app-error" role="alert">
          {error}
          <button type="button" onClick={() => setError("")}>
            Dismiss
          </button>
        </div>
      )}
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
      {selected && !trash && user ? (
        <Editor
          note={selected}
          token={localStorage.getItem("token") ?? ""}
          user={user}
          onChanged={() => void load()}
        />
      ) : (
        <div className="empty">Create a note to get started.</div>
      )}
    </main>
  );
}
