import Link from "next/link";
import { Check, CircleCheck, Heart, ListPlus } from "lucide-react";
import type { Book } from "@/domain/book";
import { canQueue } from "@/domain/readingActions";
import { ROUTES } from "@/routes";
import { BookCover } from "./BookCover";

/** Hooks a tile up to the Next books queue (only Browse does this). */
export interface TileQueue {
  queued: boolean;
  onToggle: () => void;
}

function Tile({ book }: { book: Book }) {
  return (
    <Link className="tile" href={ROUTES.book(book.id)}>
      <span className="tile__cover">
        <BookCover book={book} decorative />
        {book.status === "read" ? (
          <span className="tile__read" role="img" aria-label="Read">
            <CircleCheck size={14} aria-hidden="true" />
          </span>
        ) : null}
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

/**
 * Grid tile. The whole tile is one link to the book. With `queue`, a small button on the jacket adds the book to
 * (or takes it off) the Next books queue; it sits beside the link, never inside it.
 */
export function BookCard({ book, queue }: { book: Book; queue?: TileQueue }) {
  if (!queue || !canQueue(book)) return <Tile book={book} />;
  return (
    <div className="tilewrap">
      <Tile book={book} />
      <span className="tile__over">
        <button
          type="button"
          className={`tile__next${queue.queued ? " is-on" : ""}`}
          aria-pressed={queue.queued}
          aria-label={queue.queued ? `Take ${book.title} off Next books` : `Add ${book.title} to Next books`}
          onClick={queue.onToggle}
        >
          {queue.queued ? <Check size={18} aria-hidden="true" /> : <ListPlus size={18} aria-hidden="true" />}
        </button>
      </span>
    </div>
  );
}
