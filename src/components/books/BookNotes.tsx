"use client";

import { useId, useMemo, useState } from "react";
import { notesInOrder } from "@/domain/readingActions";
import { useLibrary } from "@/hooks/useLibrary";
import { LinkedText } from "@/components/reading/LinkedText";

/** When the note was written: the day and the time, so notes taken while reading stay in order. */
const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

/**
 * Private notes on one book: add, edit, delete. Many per book, oldest first so they read like a journal. A note
 * can carry the chapter it is about, and any web links in it (a website, a YouTube video) are tappable.
 */
export function BookNotes({ bookId }: { bookId: string }) {
  const { notes, addNote, updateNote, deleteNote } = useLibrary();
  const mine = useMemo(() => notesInOrder(notes.filter((n) => n.bookId === bookId)), [notes, bookId]);

  const newId = useId();
  const chapterId = useId();
  const [draft, setDraft] = useState("");
  const [chapter, setChapter] = useState("");
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [editChapter, setEditChapter] = useState("");
  const [editError, setEditError] = useState("");

  async function submit() {
    if (!draft.trim()) {
      setError("Write something first.");
      return;
    }
    setError("");
    if (await addNote(bookId, draft, chapter)) {
      setDraft("");
      setChapter("");
    }
  }

  async function saveEdit(id: string) {
    if (!editDraft.trim()) {
      setEditError("A note can't be empty. Delete it instead.");
      return;
    }
    setEditError("");
    if (await updateNote(id, editDraft, editChapter)) setEditing(null);
  }

  return (
    <section id="notes" className="stack" style={{ padding: 0 }} aria-labelledby="notes-h">
      <h2 id="notes-h" style={{ fontSize: 18 }}>
        Private notes ({mine.length})
      </h2>

      {mine.map((n) =>
        editing === n.id ? (
          <div key={n.id} className="card notecard">
            <div className="field">
              <label htmlFor={`edit-chapter-${n.id}`}>Chapter (optional)</label>
              <input
                id={`edit-chapter-${n.id}`}
                className="input"
                value={editChapter}
                placeholder="Ch. 12"
                onChange={(e) => setEditChapter(e.target.value)}
              />
            </div>
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
            {n.chapter ? (
              <div>
                <span className="tag" aria-label="Chapter">
                  {n.chapter}
                </span>
              </div>
            ) : null}
            <LinkedText text={n.body} />
            <div className="notecard__meta">
              <span>{when(n.createdAt)}</span>
              <span className="notecard__actions">
                <button
                  type="button"
                  className="btn btn--small"
                  onClick={() => {
                    setEditing(n.id);
                    setEditDraft(n.body);
                    setEditChapter(n.chapter ?? "");
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
        <label htmlFor={chapterId}>Chapter (optional)</label>
        <input id={chapterId} className="input" value={chapter} placeholder="Ch. 12" onChange={(e) => setChapter(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor={newId}>Add a note</label>
        <textarea
          id={newId}
          className="textarea"
          value={draft}
          placeholder="Only you can see this. Paste a website or YouTube link and it becomes tappable."
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
