"use client";

import { useId, useMemo, useState } from "react";
import { useLibrary } from "@/hooks/useLibrary";

const when = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

/** Private notes on one book: add, edit, delete. Many per book. */
export function BookNotes({ bookId }: { bookId: string }) {
  const { notes, addNote, updateNote, deleteNote } = useLibrary();
  const mine = useMemo(
    () => notes.filter((n) => n.bookId === bookId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [notes, bookId],
  );

  const newId = useId();
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [editError, setEditError] = useState("");

  async function submit() {
    if (!draft.trim()) {
      setError("Write something first.");
      return;
    }
    setError("");
    if (await addNote(bookId, draft)) setDraft("");
  }

  async function saveEdit(id: string) {
    if (!editDraft.trim()) {
      setEditError("A note can't be empty. Delete it instead.");
      return;
    }
    setEditError("");
    if (await updateNote(id, editDraft)) setEditing(null);
  }

  return (
    <section className="stack" style={{ padding: 0 }} aria-labelledby="notes-h">
      <h2 id="notes-h" style={{ fontSize: 18 }}>
        Private notes ({mine.length})
      </h2>

      {mine.map((n) =>
        editing === n.id ? (
          <div key={n.id} className="card notecard">
            <label className="sr-only" htmlFor={`edit-${n.id}`}>
              Edit note
            </label>
            <textarea
              id={`edit-${n.id}`}
              className="textarea"
              value={editDraft}
              onChange={(e) => {
                setEditDraft(e.target.value);
                setEditError("");
              }}
            />
            {editError ? <p className="error">{editError}</p> : null}
            <div className="notecard__actions">
              <button type="button" className="btn btn--primary btn--small" onClick={() => void saveEdit(n.id)}>
                Save
              </button>
              <button type="button" className="btn btn--small" onClick={() => setEditing(null)}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div key={n.id} className="card notecard">
            <p style={{ whiteSpace: "pre-wrap" }}>{n.body}</p>
            <div className="notecard__meta">
              <span>{when(n.updatedAt)}</span>
              <span className="notecard__actions">
                <button
                  type="button"
                  className="btn btn--small"
                  onClick={() => {
                    setEditing(n.id);
                    setEditDraft(n.body);
                    setEditError("");
                  }}
                >
                  Edit
                </button>
                <button type="button" className="btn btn--small" onClick={() => void deleteNote(n.id)}>
                  Delete
                </button>
              </span>
            </div>
          </div>
        ),
      )}

      <div className="field">
        <label htmlFor={newId}>Add a note</label>
        <textarea
          id={newId}
          className="textarea"
          value={draft}
          placeholder="Only you can see this"
          onChange={(e) => {
            setDraft(e.target.value);
            setError("");
          }}
        />
        {error ? <p className="error">{error}</p> : null}
        <button type="button" className="btn btn--primary" onClick={() => void submit()}>
          Save note
        </button>
      </div>
    </section>
  );
}
