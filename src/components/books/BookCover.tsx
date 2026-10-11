"use client";

import { useState } from "react";
import type { Book } from "@/domain/book";
import { largeCoverUrl } from "@/lib/coverUrl";

/** A real cover when there is one; otherwise a tasteful title tile. */
export function BookCover({
  book,
  decorative = false,
  large = false,
  className = "",
}: {
  book: Pick<Book, "title" | "coverUrl">;
  decorative?: boolean;
  /** Use the bigger jacket (the book page); lists keep the small one so they load fast. */
  large?: boolean;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);

  if (book.coverUrl && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        className={`cover cover--image ${className}`}
        src={large ? largeCoverUrl(book.coverUrl) : book.coverUrl}
        alt={decorative ? "" : `Cover of ${book.title}`}
        loading="lazy"
        onError={() => setFailed(true)}
      />
    );
  }
  return (
    <div
      className={`cover cover--fallback ${className}`}
      role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : `Cover of ${book.title}`}
      aria-hidden={decorative || undefined}
    >
      <span>{book.title}</span>
    </div>
  );
}
