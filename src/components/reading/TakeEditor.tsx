"use client";

import { useId, useState } from "react";
import { takeFor } from "@/domain/readingActions";
import { useLibrary } from "@/hooks/useLibrary";

/** "My Take" on a finished book: a few lines, private, editable any time. */
export function TakeEditor({ bookId }: { bookId: string }) {
  const { takes, setTake } = useLibrary();
  const id = useId();
  const saved = takeFor(takes, bookId)?.body ?? "";
  const [draft, setDraft] = useState(saved);
  const changed = draft.trim() !== saved;

  return (
    <div className="field">
      <label htmlFor={id}>My Take</label>
      <textarea
        id={id}
        className="textarea"
        value={draft}
        placeholder="What you thought, in a line or two. Only you can see this."
        onChange={(e) => setDraft(e.target.value)}
      />
      <div>
        <button type="button" className="btn btn--small" disabled={!changed} onClick={() => void setTake(bookId, draft)}>
          Save my take
        </button>
      </div>
    </div>
  );
}
