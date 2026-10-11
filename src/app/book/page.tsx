"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, ExternalLink, Heart, Pencil, Trash2, Undo2 } from "lucide-react";
import { READING_STATUSES, STATUS_LABEL } from "@/domain/book";
import { amazonSearchUrl, bookFacts } from "@/domain/bookActions";
import { useLibrary } from "@/hooks/useLibrary";
import { ROUTES } from "@/routes";
import { BookCover } from "@/components/books/BookCover";
import { BookNotes } from "@/components/books/BookNotes";
import { EmptyState } from "@/components/shared/EmptyState";

export default function BookPage() {
  return (
    <Suspense fallback={null}>
      <BookView />
    </Suspense>
  );
}

function BookView() {
  const id = useSearchParams().get("id");
  const { findBook, ready, setStatus, toggleFavorite, removeBook, restoreBook } = useLibrary();
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
        <a className="btn" href={amazonSearchUrl(book)} target="_blank" rel="noopener noreferrer">
          <ExternalLink size={18} aria-hidden="true" /> Find on Amazon
        </a>
        <Link className="btn" href={ROUTES.edit(book.id)}>
          <Pencil size={18} aria-hidden="true" /> Edit
        </Link>
        <button type="button" className="btn" onClick={() => void remove()}>
          <Trash2 size={18} aria-hidden="true" /> Remove this book
        </button>
      </div>

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
