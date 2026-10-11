import type { Book } from "../../src/domain/book";
import { coverUrl } from "../../src/lib/openLibrary";

export { largeCoverUrl } from "../../src/lib/coverUrl";

export { authorKey, bestCoverId, coverUrl, pickMatch, type OlDoc } from "../../src/lib/openLibrary";

export interface CoverRow {
  id: string;
  coverId: number;
}

export function parseCovers(text: string): CoverRow[] {
  return text
    .split(/\r?\n/)
    .filter((l) => l.trim() && !l.startsWith("#"))
    .map((l) => {
      const [id, coverId] = l.split("|");
      return { id: id.trim(), coverId: Number(coverId) };
    })
    .filter((r) => r.id && Number.isInteger(r.coverId) && r.coverId > 0);
}

/** Puts each found jacket on its book. A book with no entry simply has no cover (never guessed). */
export function applyCovers(books: Book[], rows: CoverRow[]): void {
  const byId = new Map(rows.map((r) => [r.id, r.coverId]));
  for (const b of books) {
    const id = byId.get(b.id);
    if (id) b.coverUrl = coverUrl(id);
  }
}
