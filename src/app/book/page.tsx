"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Check, CircleCheck, ExternalLink, Heart, ListPlus, Pencil, Star, Trash2, Undo2 } from "lucide-react";
import { READING_STATUSES, STATUS_LABEL } from "@/domain/book";
import { amazonUrl, bookFacts } from "@/domain/bookActions";
import { canQueue, dayLabel, isQueued, takeFor } from "@/domain/readingActions";
import { useLibrary } from "@/hooks/useLibrary";
import { ROUTES } from "@/routes";
import { BookCover } from "@/components/books/BookCover";
import { BookNotes } from "@/components/books/BookNotes";
import { AddToList } from "@/components/lists/AddToList";
import { EmptyState } from "@/components/shared/EmptyState";
import { ReadingControls } from "@/components/reading/ReadingControls";
import { TakeEditor } from "@/components/reading/TakeEditor";

export default function BookPage() {
  return (
    <Suspense fallback={null}>
      <BookView />
    </Suspense>
  );
}

function BookView() {
  const id = useSearchParams().get("id");
  const { findBook, ready, setStatus, setReadDetails, toggleFavorite, removeBook, restoreBook, nextItems, addToNext, removeFromNext, takes } = useLibrary();
  const router = useRouter();
  const book = id ? findBook(id) : undefined;

  if (!ready) {
    return (
      <div className="stack">
        <p className="muted">Loading…</p>
      </div>
    );
  }

  if (!book) {
    return (
      <div className="stack">
        <Link className="back" href={ROUTES.browse}>
          <ArrowLeft size={16} aria-hidden="true" /> Browse
        </Link>
        <EmptyState
          title="Book not found"
          body="That book isn't in your library. It may have been removed."
          action={
            <Link className="btn btn--primary" href={ROUTES.browse}>
              Browse books
            </Link>
          }
        />
      </div>
    );
  }

  if (book.removedAt) {
    return (
      <div className="stack">
        <Link className="back" href={ROUTES.browse}>
          <ArrowLeft size={16} aria-hidden="true" /> Browse
        </Link>
        <EmptyState
          title="This book was removed"
          body={`${book.title} is hidden everywhere, but nothing was deleted. Restore it to bring it back with its notes and lists.`}
          action={
            <button type="button" className="btn btn--primary" onClick={() => void restoreBook(book.id)}>
              <Undo2 size={18} aria-hidden="true" /> Restore this book
            </button>
          }
        />
      </div>
    );
  }

  async function remove() {
    if (!book) return;
    if (await removeBook(book.id)) router.replace(ROUTES.browse);
  }

  const score = book.rating !== undefined && book.sources.some((s) => s.source === "Man Book Club");

  return (
    <div className="stack">
      <Link className="back" href={ROUTES.browse}>
        <ArrowLeft size={16} aria-hidden="true" /> Browse
      </Link>

      <div className="detail">
        <div className="detail__cover">
          <BookCover book={book} large />
        </div>
        <div style={{ minWidth: 0 }}>
          <h1>{book.title}</h1>
          {book.author ? (
            <p className="muted" style={{ margin: "4px 0 0" }}>
              {book.author}
            </p>
          ) : null}
          {bookFacts(book) ? (
            <p className="muted" style={{ margin: "2px 0 10px", fontSize: 14 }}>
              {bookFacts(book)}
            </p>
          ) : (
            <div style={{ height: 10 }} />
          )}
          <div>
            {book.sources.map((s) => (
              <Link key={s.source} className="tag" href={ROUTES.browseWith({ source: s.source })}>
                {s.source}
              </Link>
            ))}
          </div>
          <div>
            {[...book.genres, ...book.moods].map((t, i) => (
              <span key={`${t}-${i}`} className="tag tag--genre">
                {t}
              </span>
            ))}
          </div>
        </div>
      </div>

      {score ? (
        <div className="card scoreline">
          <span className="muted">Man Book Club score</span>
          <strong>{book.rating!.toFixed(1)} / 10</strong>
        </div>
      ) : null}

      {book.sourceNote ? (
        <p>
          <span className="muted">Notes: </span>
          {book.sourceNote}
        </p>
      ) : null}

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button
          type="button"
          className={`btn${book.favorite ? " btn--primary" : ""}`}
          aria-pressed={book.favorite}
          onClick={() => void toggleFavorite(book.id)}
        >
          <Heart size={18} aria-hidden="true" /> {book.favorite ? "Favorited" : "Favorite"}
        </button>
        {canQueue(book) ? (
          <button
            type="button"
            className={`btn${isQueued(nextItems, book.id) ? " btn--primary" : ""}`}
            aria-pressed={isQueued(nextItems, book.id)}
            onClick={() => void (isQueued(nextItems, book.id) ? removeFromNext(book.id) : addToNext(book.id))}
          >
            {isQueued(nextItems, book.id) ? <Check size={18} aria-hidden="true" /> : <ListPlus size={18} aria-hidden="true" />}{" "}
            {isQueued(nextItems, book.id) ? "In Next books" : "Add to Next books"}
          </button>
        ) : null}
        <button
          type="button"
          className={`btn${book.status === "read" ? " btn--primary" : ""}`}
          aria-pressed={book.status === "read"}
          onClick={() => void setStatus(book.id, book.status === "read" ? "want_to_read" : "read")}
        >
          <CircleCheck size={18} aria-hidden="true" /> Mark as read
        </button>
        <a className="btn" href={amazonUrl(book)} target="_blank" rel="noopener noreferrer">
          <ExternalLink size={18} aria-hidden="true" /> Find on Amazon
        </a>
        <Link className="btn" href={ROUTES.edit(book.id)}>
          <Pencil size={18} aria-hidden="true" /> Edit
        </Link>
        <button type="button" className="btn" onClick={() => void remove()}>
          <Trash2 size={18} aria-hidden="true" /> Remove this book
        </button>
      </div>

      {book.status === "reading" ? (
        <section aria-labelledby="now-h" className="card stack" style={{ gap: 10 }}>
          <h2 id="now-h" style={{ fontSize: 18 }}>
            Reading now
          </h2>
          <ReadingControls book={book} />
          <p className="muted" style={{ fontSize: 13 }}>
            Start records today&apos;s date, and Finish asks for a rating and your take. Add notes below as you go.
          </p>
        </section>
      ) : null}

      {book.status === "read" ? (
        <section aria-labelledby="reading-h" className="card stack" style={{ gap: 12 }}>
          <h2 id="reading-h" style={{ fontSize: 18 }}>
            Your reading
          </h2>
          {book.startedOn ? (
            <p>
              <span className="muted">Started: </span>
              {dayLabel(book.startedOn)}
            </p>
          ) : null}
          <div className="field">
            <label htmlFor="finished-on">Date finished (optional)</label>
            <input
              id="finished-on"
              type="date"
              className="input"
              value={book.finishedOn ?? ""}
              onChange={(e) => void setReadDetails(book.id, { finishedOn: e.target.value || undefined, myRating: book.myRating })}
            />
          </div>
          <div role="group" aria-label="Your rating" className="stars">
            <span className="muted" style={{ fontSize: 14, marginRight: 6 }}>
              Your rating
            </span>
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                className={`star${(book.myRating ?? 0) >= n ? " is-on" : ""}`}
                aria-label={`${n} ${n === 1 ? "star" : "stars"}`}
                aria-pressed={book.myRating === n}
                onClick={() => void setReadDetails(book.id, { finishedOn: book.finishedOn, myRating: book.myRating === n ? undefined : n })}
              >
                <Star size={26} aria-hidden="true" />
              </button>
            ))}
          </div>
          <TakeEditor key={takeFor(takes, book.id)?.body ?? ""} bookId={book.id} />
          <p className="muted" style={{ fontSize: 13 }}>
            Add notes below. Notes and your take are private.
          </p>
        </section>
      ) : null}

      <AddToList bookId={book.id} />

      <section aria-labelledby="status-h">
        <h2 id="status-h" style={{ fontSize: 18, marginBottom: 10 }}>
          Status
        </h2>
        <div className="statusbar" role="group" aria-label="Reading status">
          {READING_STATUSES.map((s) => (
            <button
              key={s}
              type="button"
              className={`chip${book.status === s ? " is-on" : ""}`}
              aria-pressed={book.status === s}
              onClick={() => void setStatus(book.id, s)}
            >
              {STATUS_LABEL[s]}
            </button>
          ))}
        </div>
      </section>

      <BookNotes bookId={book.id} />
    </div>
  );
}
