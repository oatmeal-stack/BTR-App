"use client";

import { useState } from "react";
import { CircleCheck, Play } from "lucide-react";
import type { Book } from "@/domain/book";
import { dayLabel } from "@/domain/readingActions";
import { useLibrary } from "@/hooks/useLibrary";
import { FinishSheet } from "./FinishSheet";

/**
 * Start and Finish for a book being read. Start records the day you pressed it and nothing else does; Finish
 * asks for a rating and your take, then moves the book into your finished books.
 */
export function ReadingControls({ book }: { book: Book }) {
  const { startReading } = useLibrary();
  const [finishing, setFinishing] = useState(false);

  return (
    <>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        {book.startedOn ? (
          <span className="muted" style={{ fontSize: 14 }}>
            Started {dayLabel(book.startedOn)}
          </span>
        ) : (
          <button type="button" className="btn btn--small" aria-label={`Start ${book.title}`} onClick={() => void startReading(book.id)}>
            <Play size={16} aria-hidden="true" /> Start
          </button>
        )}
        <button type="button" className="btn btn--small btn--primary" aria-label={`Finish ${book.title}`} onClick={() => setFinishing(true)}>
          <CircleCheck size={16} aria-hidden="true" /> Finish
        </button>
      </div>
      {finishing ? <FinishSheet book={book} onClose={() => setFinishing(false)} /> : null}
    </>
  );
}
