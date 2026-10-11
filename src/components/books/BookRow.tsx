"use client";

import Link from "next/link";
import { Heart } from "lucide-react";
import type { Book } from "@/domain/book";
import { useLibrary } from "@/hooks/useLibrary";
import { ROUTES } from "@/routes";
import { StatusChip } from "@/components/shared/StatusChip";
import { BookCover } from "./BookCover";

/** Compact list row: link to the book, plus a separate favorite button. */
export function BookRow({ book }: { book: Book }) {
  const { toggleFavorite } = useLibrary();
  return (
    <li className="row">
      <Link className="row__main" href={ROUTES.book(book.id)}>
        <BookCover book={book} decorative className="row__cover" />
        <span className="row__text">
          <span className="row__title">{book.title}</span>
          {book.author ? <span className="row__author">{book.author}</span> : null}
          <StatusChip status={book.status} />
        </span>
      </Link>
      <button
        type="button"
        className={`iconbtn iconbtn--quiet${book.favorite ? " is-on" : ""}`}
        aria-pressed={book.favorite}
        aria-label={book.favorite ? `Remove ${book.title} from favorites` : `Add ${book.title} to favorites`}
        onClick={() => void toggleFavorite(book.id)}
      >
        <Heart size={18} aria-hidden="true" />
      </button>
    </li>
  );
}
