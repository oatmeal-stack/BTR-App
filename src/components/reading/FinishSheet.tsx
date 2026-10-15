"use client";

import { useEffect, useId, useState } from "react";
import { X } from "lucide-react";
import type { Book } from "@/domain/book";
import { takeFor } from "@/domain/readingActions";
import { useLibrary } from "@/hooks/useLibrary";
import { StarRating } from "./StarRating";

/** Pressing Finish asks for a rating and a short take (both optional), then moves the book into your finished books. */
export function FinishSheet({ book, onClose }: { book: Book; onClose: () => void }) {
  const { finishReading, takes } = useLibrary();
  const takeId = useId();
  const [rating, setRating] = useState<number | undefined>(book.myRating);
  const [take, setTake] = useState(takeFor(takes, book.id)?.body ?? "");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function finish() {
    setBusy(true);
    const ok = await finishReading(book.id, { rating, take });
    setBusy(false);
    if (ok) onClose();
  }

  return (
    <div className="sheet" role="dialog" aria-modal="true" aria-label={`Finish ${book.title}`}>
      <div className="sheet__panel">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
          <strong style={{ fontFamily: "var(--font-heading)", fontSize: 18, overflowWrap: "anywhere" }}>Finish {book.title}</strong>
          <button type="button" className="iconbtn iconbtn--quiet" aria-label="Close" onClick={onClose}>
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        <StarRating value={rating} onChange={setRating} />
        <div className="field">
          <label htmlFor={takeId}>My Take (optional)</label>
          <textarea
            id={takeId}
            className="textarea"
            value={take}
            placeholder="A line or two on what you thought. Only you can see this."
            onChange={(e) => setTake(e.target.value)}
          />
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" className="btn btn--primary" disabled={busy} onClick={() => void finish()}>
            {busy ? "Finishing…" : "Finish book"}
          </button>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
