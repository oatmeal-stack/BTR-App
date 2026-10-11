import Link from "next/link";
import { Heart } from "lucide-react";
import type { Book } from "@/domain/book";
import { ROUTES } from "@/routes";
import { BookCover } from "./BookCover";

/** Grid tile. The whole tile is one link to the book. */
export function BookCard({ book }: { book: Book }) {
  return (
    <Link className="tile" href={ROUTES.book(book.id)}>
      <span className="tile__cover">
        <BookCover book={book} decorative />
        {book.favorite ? (
          <span className="tile__fav" role="img" aria-label="Favorite">
            <Heart size={14} aria-hidden="true" />
          </span>
        ) : null}
      </span>
      <span className="tile__title">{book.title}</span>
      {book.author ? <span className="tile__author">{book.author}</span> : null}
    </Link>
  );
}
