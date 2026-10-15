import Link from "next/link";
import type { Book } from "@/domain/book";
import { ROUTES } from "@/routes";

/**
 * Where a book came from (its source tags), kept on the book through the queue, reading and finished. A book
 * with none says so and points at Edit, where one can be added.
 */
export function SourceTags({ book, plain = false }: { book: Pick<Book, "id" | "sources">; plain?: boolean }) {
  if (book.sources.length === 0) {
    return (
      <span className="muted" style={{ fontSize: 13 }}>
        No source yet{plain ? null : <>. <Link href={ROUTES.edit(book.id)}>Add one</Link></>}
      </span>
    );
  }
  return (
    <span aria-label="Source">
      {book.sources.map((s) => (
        <span key={s.source} className="tag">
          {s.source}
        </span>
      ))}
    </span>
  );
}
