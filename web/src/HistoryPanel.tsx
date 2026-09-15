import { useEffect, useRef, useState, type ReactElement } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Collaboration from "@tiptap/extension-collaboration";
import * as Y from "yjs";
import { api } from "./api";
import type { Note, Snapshot } from "./types";

function decodeState(state: string): Uint8Array {
  const binary = atob(state.replace(/\s/g, ""));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function SnapshotView({ doc }: { doc: Y.Doc }): ReactElement {
  const editor = useEditor({
    editable: false,
    extensions: [
      StarterKit.configure({ history: false }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Collaboration.configure({
        document: doc,
        field: "prosemirror",
      }),
    ],
    editorProps: { attributes: { class: "editor history-editor" } },
  });

  return editor ? <EditorContent editor={editor} /> : <div className="history-editor" />;
}

export function HistoryPanel({
  note,
  onRestore,
  onClose,
}: {
  note: Note;
  onRestore: () => void;
  onClose: () => void;
}): ReactElement {
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loadingStates, setLoadingStates] = useState(true);
  const [restoring, setRestoring] = useState(false);
  const [error, setError] = useState("");
  const stateCache = useRef(new Map<string, Uint8Array>());
  const docCache = useRef(new Map<string, Y.Doc>());

  useEffect(() => {
    let active = true;
    let requestInFlight = false;

    const load = async (): Promise<void> => {
      if (requestInFlight) {
        return;
      }
      requestInFlight = true;
      try {
        const next = await api<Snapshot[]>(`/notes/${note.id}/history`);
        const sorted = [...next].sort(
          (left, right) =>
            new Date(left.created_at).getTime() - new Date(right.created_at).getTime(),
        );
        if (!active) {
          return;
        }
        setSnapshots(sorted);
        const missing = sorted.filter((snapshot) => !stateCache.current.has(snapshot.id));
        setLoadingStates(missing.length > 0);
        await Promise.all(
          missing.map(async (snapshot) => {
            const detail = await api<Snapshot>(
              `/notes/${note.id}/history/${snapshot.id}`,
            );
            if (detail.state === undefined) {
              throw new Error("Snapshot state is missing");
            }
            stateCache.current.set(snapshot.id, decodeState(detail.state));
          }),
        );
        if (active) {
          setError("");
        }
      } catch (cause) {
        if (active) {
          setError(cause instanceof Error ? cause.message : "Unable to load history");
        }
      } finally {
        requestInFlight = false;
        if (active) {
          setLoadingStates(false);
        }
      }
    };

    void load();
    const timer = setInterval(() => void load(), 3000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [note.id]);

  useEffect(() => {
    setSelectedId((current) => {
      if (current && snapshots.some((snapshot) => snapshot.id === current)) {
        return current;
      }
      return snapshots[snapshots.length - 1]?.id ?? null;
    });
  }, [snapshots]);

  useEffect(
    () => () => {
      for (const doc of docCache.current.values()) {
        doc.destroy();
      }
      docCache.current.clear();
      stateCache.current.clear();
    },
    [],
  );

  const selectedIndex = Math.max(
    0,
    snapshots.findIndex((snapshot) => snapshot.id === selectedId),
  );
  const selectedSnapshot = snapshots[selectedIndex];
  const selectedDoc = selectedSnapshot
    ? (() => {
        const cached = docCache.current.get(selectedSnapshot.id);
        if (cached) {
          return cached;
        }
        const state = stateCache.current.get(selectedSnapshot.id);
        if (!state) {
          return null;
        }
        const doc = new Y.Doc();
        Y.applyUpdate(doc, state);
        docCache.current.set(selectedSnapshot.id, doc);
        return doc;
      })()
    : null;

  async function restore(): Promise<void> {
    if (!selectedSnapshot) {
      return;
    }
    setRestoring(true);
    setError("");
    try {
      await api(`/notes/${note.id}/history/${selectedSnapshot.id}/restore`, {
        method: "POST",
      });
      onRestore();
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to restore version");
    } finally {
      setRestoring(false);
    }
  }

  return (
    <section className="history">
      <div className="history-header">
        <h2>History</h2>
        <div className="history-header-actions">
          <button
            disabled={loadingStates || !selectedDoc || restoring}
            onClick={() => void restore()}
          >
            {restoring ? "Restoring…" : "Restore this version"}
          </button>
          <button onClick={onClose}>Close</button>
        </div>
      </div>
      {snapshots.length === 0 ? (
        <p>No history yet</p>
      ) : (
        <>
          <p className="history-caption">
            {loadingStates || !selectedSnapshot
              ? "Loading versions…"
              : `${new Date(selectedSnapshot.created_at).toLocaleString()} — version ${
                  selectedIndex + 1
                } of ${snapshots.length}`}
          </p>
          <div className="history-slider">
            <input
              aria-label="History version"
              type="range"
              min={0}
              max={Math.max(0, snapshots.length - 1)}
              value={selectedIndex}
              disabled={loadingStates}
              onChange={(event) =>
                setSelectedId(snapshots[Number(event.target.value)]?.id ?? null)
              }
            />
            <div className="history-range-labels">
              <span>{new Date(snapshots[0].created_at).toLocaleString()}</span>
              <span>now</span>
            </div>
          </div>
          {selectedDoc && selectedSnapshot && (
            <SnapshotView doc={selectedDoc} key={selectedSnapshot.id} />
          )}
        </>
      )}
      {error && (
        <p className="share-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
