import { useEffect, useState, type ReactElement } from "react";
import { api } from "./api";
import type { Note, Snapshot } from "./types";
export function HistoryPanel({
  note,
  onRestore,
}: {
  note: Note;
  onRestore: () => void;
}): ReactElement {
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [preview, setPreview] = useState<Snapshot | null>(null);
  useEffect(() => {
    void api<Snapshot[]>(`/notes/${note.id}/history`).then(setSnapshots);
  }, [note.id]);
  async function open(snapshot: Snapshot): Promise<void> {
    setPreview(await api<Snapshot>(`/notes/${note.id}/history/${snapshot.id}`));
  }
  async function restore(): Promise<void> {
    if (preview) {
      await api(`/notes/${note.id}/history/${preview.id}/restore`, { method: "POST" });
      onRestore();
    }
  }
  return (
    <section className="history">
      <h2>History</h2>
      {snapshots.map((snapshot) => (
        <button key={snapshot.id} onClick={() => void open(snapshot)}>
          {new Date(snapshot.created_at).toLocaleString()} —{" "}
          {snapshot.excerpt || "Empty note"}
        </button>
      ))}
      {preview && (
        <div className="history-preview">
          <p>{preview.excerpt || "Empty note"}</p>
          <button onClick={() => void restore()}>Restore this version</button>
        </div>
      )}
    </section>
  );
}
