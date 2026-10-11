"use client";

import Link from "next/link";
import { ArrowLeft, Undo2 } from "lucide-react";
import { useLibrary } from "@/hooks/useLibrary";
import { ROUTES } from "@/routes";
import { BookCover } from "@/components/books/BookCover";
import { EmptyState } from "@/components/shared/EmptyState";
import { ScenicBanner } from "@/components/shared/ScenicBanner";

/** Books you removed. Nothing was deleted: Restore brings one back with its notes, lists and tags. */
export default function RemovedPage() {
  const { removedBooks, restoreBook, ready } = useLibrary();

  return (
    <>
      <ScenicBanner slot="browseBanner" title="Removed books" subtitle="Hidden everywhere, never deleted." />
      <div className="stack">
        <Link className="back" href={ROUTES.profile}>
          <ArrowLeft size={16} aria-hidden="true" /> Profile
        </Link>

        {!ready ? (
          <p className="muted">Loading…</p>
        ) : removedBooks.length === 0 ? (
          <EmptyState title="Nothing removed" body="Books you remove from the archive will wait here in case you change your mind." />
        ) : (
          <ul className="rows" aria-label="Removed books">
            {removedBooks.map((book) => (
              <li key={book.id} className="row">
                <Link className="row__main" href={ROUTES.book(book.id)}>
                  <BookCover book={book} decorative className="row__cover" />
                  <span className="row__text">
                    <span className="row__title">{book.title}</span>
                    {book.author ? <span className="row__author">{book.author}</span> : null}
                  </span>
                </Link>
                <button
                  type="button"
                  className="btn btn--small"
                  aria-label={`Restore ${book.title}`}
                  onClick={() => void restoreBook(book.id)}
                >
                  <Undo2 size={16} aria-hidden="true" /> Restore
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
