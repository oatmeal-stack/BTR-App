import {
  MY_ADDITIONS,
  SOURCE_LISTS,
  type Book,
  type BookNote,
  type NewBookInput,
  type ReadingStatus,
  type SourceTag,
} from "./book";

/* ---------- matching ---------- */

export function normalizeText(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normalizeTitle(title: string): string {
  return normalizeText(title).replace(/^(the|a|an) /, "");
}

function lastName(author: string): string {
  const parts = normalizeText(author).split(" ").filter(Boolean);
  return parts[parts.length - 1] ?? "";
}

/**
 * Same title, and authors that agree on last name. Man Book Club lists last
 * names only ("McMurtry"), the other lists use full names, so compare the last
 * word. If either side has no author the titles alone must match exactly.
 */
export function isSameBook(
  a: { title: string; author?: string },
  b: { title: string; author?: string },
): boolean {
  if (normalizeTitle(a.title) !== normalizeTitle(b.title)) return false;
  if (!a.author || !b.author) return true;
  return lastName(a.author) === lastName(b.author);
}

/**
 * A book's identity for removals: the normalized title (no leading article) and the author's last
 * name. A removal records this, so re-importing the book under a slightly different spelling
 * ("The Road" / "Road", accents, punctuation) still doesn't bring it back.
 */
export function importKey(title: string, author?: string): string {
  return `${normalizeTitle(title)}|${author ? lastName(author) : ""}`;
}

export function amazonSearchUrl(book: { title: string; author?: string }): string {
  const q = [book.title, book.author].filter(Boolean).join(" ");
  return `https://www.amazon.com/s?k=${encodeURIComponent(q).replace(/%20/g, "+")}`;
}

/* ---------- changing the library (pure) ---------- */

function mergeSources(a: SourceTag[], b: SourceTag[]): SourceTag[] {
  const out = [...a];
  for (const s of b) {
    if (!out.some((x) => x.source === s.source)) out.push(s);
  }
  return out;
}

export interface AddResult {
  books: Book[];
  book: Book;
  created: boolean;
}

/** Adds a book, or folds it into the existing one so it appears once. */
export function addBookToLibrary(
  books: Book[],
  input: NewBookInput,
  now: string,
  newId: string,
): AddResult {
  const title = input.title.trim();
  const author = input.author?.trim() || undefined;
  const note = input.note?.trim() || undefined;
  const existing = books.find((b) => isSameBook(b, { title, author }));

  if (existing) {
    const sourceNote =
      note && !existing.sourceNote?.includes(note)
        ? [existing.sourceNote, note].filter(Boolean).join(". ")
        : existing.sourceNote;
    const merged: Book = {
      ...existing,
      sources: mergeSources(existing.sources, input.sources ?? []),
      sourceNote,
      updatedAt: now,
    };
    return {
      books: books.map((b) => (b.id === existing.id ? merged : b)),
      book: merged,
      created: false,
    };
  }

  const book: Book = {
    id: newId,
    title,
    author,
    year: input.year,
    status: "want_to_read",
    sourceNote: note,
    favorite: false,
    genres: [],
    moods: [],
    sources: input.sources?.length ? input.sources : [{ source: MY_ADDITIONS }],
    createdAt: now,
    updatedAt: now,
  };
  return { books: [...books, book], book, created: true };
}

export function setStatus(
  books: Book[],
  id: string,
  status: ReadingStatus,
  now: string,
): Book[] {
  return books.map((b) => (b.id === id ? { ...b, status, updatedAt: now } : b));
}

export function setFavorite(
  books: Book[],
  id: string,
  favorite: boolean,
  now: string,
): Book[] {
  return books.map((b) => (b.id === id ? { ...b, favorite, updatedAt: now } : b));
}

/** A removed book is hidden everywhere. Every "find a book" function below skips them. */
export const isActive = (b: Book): boolean => !b.removedAt;

/** Soft delete: the book stays (with its notes, lists and tags) but is hidden. */
export function removeBook(books: Book[], id: string, now: string): Book[] {
  return books.map((b) => (b.id === id && !b.removedAt ? { ...b, removedAt: now, updatedAt: now } : b));
}

export function restoreBook(books: Book[], id: string, now: string): Book[] {
  return books.map((b) => {
    if (b.id !== id || !b.removedAt) return b;
    const { removedAt: _removedAt, ...rest } = b;
    void _removedAt;
    return { ...rest, updatedAt: now };
  });
}

export function addNote(
  notes: BookNote[],
  bookId: string,
  body: string,
  now: string,
  id: string,
): BookNote[] {
  const text = body.trim();
  if (!text) return notes;
  return [...notes, { id, bookId, body: text, createdAt: now, updatedAt: now }];
}

export function updateNote(
  notes: BookNote[],
  id: string,
  body: string,
  now: string,
): BookNote[] {
  const text = body.trim();
  if (!text) return notes;
  return notes.map((n) => (n.id === id ? { ...n, body: text, updatedAt: now } : n));
}

export function deleteNote(notes: BookNote[], id: string): BookNote[] {
  return notes.filter((n) => n.id !== id);
}

/* ---------- finding books (pure) ---------- */

export interface BookFilter {
  query?: string;
  source?: string;
  status?: ReadingStatus;
  genre?: string;
  mood?: string;
  favoritesOnly?: boolean;
}

export function filterBooks(books: Book[], f: BookFilter): Book[] {
  const words = f.query ? normalizeText(f.query).split(" ").filter(Boolean) : [];
  return books.filter((b) => {
    if (b.removedAt) return false;
    if (f.source && !b.sources.some((s) => s.source === f.source)) return false;
    if (f.status && b.status !== f.status) return false;
    if (f.genre && !b.genres.includes(f.genre)) return false;
    if (f.mood && !b.moods.includes(f.mood)) return false;
    if (f.favoritesOnly && !b.favorite) return false;
    if (words.length) {
      const hay = normalizeText(`${b.title} ${b.author ?? ""}`);
      if (!words.every((w) => hay.includes(w))) return false;
    }
    return true;
  });
}

export type BookSort = "recent" | "title" | "author";

export function sortBooks(books: Book[], sort: BookSort): Book[] {
  const copy = [...books];
  const byTitle = (a: Book, b: Book) =>
    normalizeTitle(a.title).localeCompare(normalizeTitle(b.title));
  if (sort === "title") return copy.sort(byTitle);
  if (sort === "author") {
    return copy.sort(
      (a, b) =>
        lastName(a.author ?? "~").localeCompare(lastName(b.author ?? "~")) ||
        byTitle(a, b),
    );
  }
  return copy.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || byTitle(a, b));
}

export function pickRandom(
  books: Book[],
  excludeId?: string | null,
  rng: () => number = Math.random,
): Book | undefined {
  const live = books.filter(isActive);
  const pool = live.filter((b) => b.id !== excludeId);
  const from = pool.length ? pool : live;
  return from[Math.floor(rng() * from.length)];
}

/** Random books from "want to read", for the Home row. */
export function pickForYou(
  books: Book[],
  count: number,
  excludeId?: string | null,
  rng: () => number = Math.random,
): Book[] {
  const pool = books.filter((b) => isActive(b) && b.status === "want_to_read" && b.id !== excludeId);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, count);
}

export function listCounts(books: Book[]): { source: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const b of books.filter(isActive)) {
    for (const s of b.sources) counts.set(s.source, (counts.get(s.source) ?? 0) + 1);
  }
  const known = SOURCE_LISTS.filter((s) => counts.has(s)).map((s) => ({
    source: s as string,
    count: counts.get(s)!,
  }));
  const extra = [...counts.entries()]
    .filter(([s]) => !(SOURCE_LISTS as readonly string[]).includes(s))
    .map(([source, count]) => ({ source, count }));
  return [...known, ...extra];
}

/** Genres or moods that actually appear, most common first. */
export function facetCounts(
  books: Book[],
  key: "genres" | "moods",
): { value: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const b of books.filter(isActive)) for (const v of b[key]) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}
