import type { Book } from "../../src/domain/book";
import { normalizeText } from "../../src/domain/bookActions";

export { largeCoverUrl } from "../../src/lib/coverUrl";

/** One result row from Open Library's search (only the fields we ask for). */
export interface OlDoc {
  key?: string;
  title?: string;
  author_name?: string[];
  cover_i?: number;
  edition_count?: number;
  /** Present when the search is asked for editions: the editions that matched (English ones, with language=eng). */
  editions?: { docs?: { cover_i?: number; language?: string[] }[] };
}

/** An English edition's jacket when the search found one, otherwise the work's general cover. */
export function bestCoverId(doc: OlDoc): number | undefined {
  const english = doc.editions?.docs?.find((e) => e.cover_i && e.language?.includes("eng"));
  return english?.cover_i ?? doc.cover_i;
}

const stripArticle = (t: string) => normalizeText(t).replace(/^(the|a|an) /, "");

/** Last word of the first author, normalised ("Cormac McCarthy" -> "mccarthy"). */
export function authorKey(author: string | undefined): string {
  const words = normalizeText(author ?? "").split(" ").filter(Boolean);
  return words[words.length - 1] ?? "";
}

/** First initial of the first author ("Frank Herbert" -> "f"), or "" when only a last name is known. */
function firstInitial(author: string | undefined): string {
  const words = normalizeText(author ?? "").split(" ").filter(Boolean);
  return words.length > 1 ? words[0][0] : "";
}

/** Same person, as far as names can tell: same last name, and the same first initial when both give one. */
function sameAuthor(want: string | undefined, got: string): boolean {
  if (authorKey(want) !== authorKey(got)) return false;
  const a = firstInitial(want);
  const b = firstInitial(got);
  return !a || !b || a === b;
}

/** An author listed only in another script (Japanese, Russian...) can't be compared to a Latin name. */
const unverifiableAuthor = (names: string[] | undefined) =>
  !!names?.length && names.every((n) => !/[A-Za-z]/.test(n));

/**
 * Picks the Open Library result that is really this book, or null. A cover for the wrong book is
 * worse than no cover, so BOTH must hold: the title matches (equal, or one starts with the other so a
 * subtitle doesn't break it) AND an author is the same person (same last name and first initial, so Brian Herbert isn't Frank). Exact titles win; then
 * the most-catalogued work, which is usually the one people mean.
 */
export function pickMatch(title: string, author: string | undefined, docs: OlDoc[]): OlDoc | null {
  const want = stripArticle(title);
  const last = authorKey(author);
  if (!want || !last) return null;

  const scored: { doc: OlDoc; exact: boolean }[] = [];
  for (const doc of docs) {
    if (!bestCoverId(doc) || !doc.title) continue;
    const got = stripArticle(doc.title);
    const exact = got === want;
    const prefix = got.startsWith(`${want} `) || want.startsWith(`${got} `);
    if (!exact && !prefix) continue;
    // A non-Latin author can't be checked, so only an EXACT title is trusted then.
    const authorOk = (doc.author_name ?? []).some((a) => sameAuthor(author, a)) || (exact && unverifiableAuthor(doc.author_name));
    if (!authorOk) continue;
    scored.push({ doc, exact });
  }
  scored.sort(
    (a, b) => Number(b.exact) - Number(a.exact) || (b.doc.edition_count ?? 0) - (a.doc.edition_count ?? 0),
  );
  return scored[0]?.doc ?? null;
}

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

export const coverUrl = (coverId: number) => `https://covers.openlibrary.org/b/id/${coverId}-M.jpg`;

/** Puts each found jacket on its book. A book with no entry simply has no cover (never guessed). */
export function applyCovers(books: Book[], rows: CoverRow[]): void {
  const byId = new Map(rows.map((r) => [r.id, r.coverId]));
  for (const b of books) {
    const id = byId.get(b.id);
    if (id) b.coverUrl = coverUrl(id);
  }
}
