"use client";

import { Suspense, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowDown, ArrowUp, MessageSquareText, MoveRight, X } from "lucide-react";
import type { Book } from "@/domain/book";
import { dayLabel, finishedBooks, moveInOrder, readingNow } from "@/domain/readingActions";
import { useLibrary } from "@/hooks/useLibrary";
import { ROUTES } from "@/routes";
import { BookCover } from "@/components/books/BookCover";
import { EmptyState } from "@/components/shared/EmptyState";
import { LoadProblem } from "@/components/shared/LoadProblem";
import { ScenicBanner } from "@/components/shared/ScenicBanner";
import { ReadingControls } from "@/components/reading/ReadingControls";
import { SourceTags } from "@/components/reading/SourceTags";

type Section = "now" | "next" | "finished";

export default function ReadingPage() {
  return (
    <Suspense fallback={null}>
      <ReadingView />
    </Suspense>
  );
}

function ReadingView() {
  const asked = useSearchParams().get("tab");
  const [section, setSection] = useState<Section>(asked === "next" || asked === "finished" ? asked : "now");
  const { books, nextBooks, notes, ready, loadFailed, requiresPasscode, unlocked } = useLibrary();

  const now = useMemo(() => readingNow(books), [books]);
  const finished = useMemo(() => finishedBooks(books), [books]);
  const locked = requiresPasscode && !unlocked;

  const tabs: { key: Section; label: string; count: number }[] = [
    { key: "now", label: "Reading now", count: now.length },
    { key: "next", label: "Next books", count: nextBooks.length },
    { key: "finished", label: "Finished", count: finished.length },
  ];

  return (
    <>
      <ScenicBanner slot="browseBanner" title="Reading" subtitle="What you're in the middle of, and what comes next." />
      <div className="stack">
        {ready && locked ? (
          <p className="card" role="status">
            Your queue, notes and takes are private. <Link href={ROUTES.profile}>Enter your passcode in Profile</Link> to use them.
          </p>
        ) : null}

        <div className="statusbar" role="group" aria-label="Reading sections">
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              className={`chip${section === t.key ? " is-on" : ""}`}
              aria-pressed={section === t.key}
              onClick={() => setSection(t.key)}
            >
              {t.label} ({t.count})
            </button>
          ))}
        </div>

        {!ready ? (
          <p className="muted">Loading your library…</p>
        ) : loadFailed ? (
          <LoadProblem />
        ) : section === "now" ? (
          <NowList books={now} noteCount={(id) => notes.filter((n) => n.bookId === id).length} />
        ) : section === "next" ? (
          <NextList books={nextBooks} />
        ) : (
          <FinishedList books={finished} />
        )}
      </div>
    </>
  );
}

/** Several books at once, each with its own card: Start, Finish, its source and its notes. */
function NowList({ books, noteCount }: { books: Book[]; noteCount: (id: string) => number }) {
  if (books.length === 0) {
    return (
      <EmptyState
        title="Nothing in progress"
        body="Move a book here from Next books, or open any book and set its status to Reading."
      />
    );
  }
  return (
    <ul className="rows" aria-label="Reading now">
      {books.map((b) => {
        const n = noteCount(b.id);
        return (
          <li key={b.id} className="card stack" style={{ gap: 10, marginBottom: 12 }}>
            <div style={{ display: "flex", gap: 12 }}>
              <Link href={ROUTES.book(b.id)} style={{ width: 64, flex: "none" }} aria-hidden="true" tabIndex={-1}>
                <BookCover book={b} decorative />
              </Link>
              <div style={{ minWidth: 0 }}>
                <Link className="row__title" href={ROUTES.book(b.id)} style={{ overflowWrap: "anywhere" }}>
                  {b.title}
                </Link>
                {b.author ? <p className="row__author">{b.author}</p> : null}
                <div>
                  <SourceTags book={b} />
                </div>
              </div>
            </div>
            <ReadingControls book={b} />
            <Link className="muted" style={{ fontSize: 14, display: "inline-flex", alignItems: "center", gap: 6 }} href={`${ROUTES.book(b.id)}#notes`}>
              <MessageSquareText size={16} aria-hidden="true" /> {n === 0 ? "Add notes" : `${n} ${n === 1 ? "note" : "notes"}`}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/** The ranked queue: first in line is on top. Move a book up or down; the order is saved. */
function NextList({ books }: { books: Book[] }) {
  const { reorderNext, removeFromNext, setStatus } = useLibrary();
  if (books.length === 0) {
    return (
      <EmptyState
        title="Your queue is empty"
        body="On Browse, tap the list button on a book's cover to line it up here, or use Add to Next books on its page."
        action={
          <Link className="btn btn--primary" href={ROUTES.browse}>
            Browse books
          </Link>
        }
      />
    );
  }
  const ids = books.map((b) => b.id);
  return (
    <ol className="rows" aria-label="Next books, in order" style={{ listStyle: "none", padding: 0, margin: 0 }}>
      {books.map((b, i) => (
        <li key={b.id} className="row" style={{ flexWrap: "wrap" }}>
          <span className="count" aria-hidden="true" style={{ width: 28, textAlign: "center", fontSize: 18 }}>
            {i + 1}
          </span>
          <Link className="row__main" href={ROUTES.book(b.id)}>
            <BookCover book={b} decorative className="row__cover" />
            <span className="row__text">
              <span className="row__title">{b.title}</span>
              {b.author ? <span className="row__author">{b.author}</span> : null}
              <SourceTags book={b} plain />
            </span>
          </Link>
          <button type="button" className="iconbtn iconbtn--quiet" aria-label={`Move ${b.title} up`} disabled={i === 0} onClick={() => void reorderNext(moveInOrder(ids, i, -1))}>
            <ArrowUp size={18} aria-hidden="true" />
          </button>
          <button type="button" className="iconbtn iconbtn--quiet" aria-label={`Move ${b.title} down`} disabled={i === books.length - 1} onClick={() => void reorderNext(moveInOrder(ids, i, 1))}>
            <ArrowDown size={18} aria-hidden="true" />
          </button>
          <button type="button" className="iconbtn iconbtn--quiet" aria-label={`Take ${b.title} off Next books`} onClick={() => void removeFromNext(b.id)}>
            <X size={18} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="btn btn--small"
            style={{ marginLeft: 40 }}
            aria-label={`Move ${b.title} to Reading now`}
            onClick={() => void setStatus(b.id, "reading")}
          >
            <MoveRight size={16} aria-hidden="true" /> Move to Reading now
          </button>
        </li>
      ))}
    </ol>
  );
}

/** The archive: every finished book, newest first. Each opens as one page with everything about it. */
function FinishedList({ books }: { books: Book[] }) {
  if (books.length === 0) {
    return <EmptyState title="Nothing finished yet" body="Press Finish on a book you're reading and it lands here with your rating and take." />;
  }
  return (
    <ul className="rows" aria-label="Finished books">
      {books.map((b) => (
        <li key={b.id} className="row">
          <Link className="row__main" href={ROUTES.book(b.id)}>
            <BookCover book={b} decorative className="row__cover" />
            <span className="row__text">
              <span className="row__title">{b.title}</span>
              {b.author ? <span className="row__author">{b.author}</span> : null}
              <span className="muted" style={{ fontSize: 13 }}>
                {b.finishedOn ? `Finished ${dayLabel(b.finishedOn)}` : "Finished"}
                {b.myRating ? ` · ${"★".repeat(b.myRating)}` : ""}
              </span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
