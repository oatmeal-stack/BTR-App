import type { Book, BookEdit, BookNote, NewBookInput, ReadingStatus } from "@/domain/book";
import * as actions from "@/domain/bookActions";
import { SEED_BOOKS } from "@/data/seedBooks";
import type { BookRepository } from "./BookRepository";

/** Versioned so a later schema change can migrate instead of breaking. */
export const STORAGE_KEY = "book-archive:v1";

interface Stored {
  version: 1;
  books: Book[];
  notes: BookNote[];
}

function newId(prefix: string): string {
  const rand =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${rand}`;
}

function seed(books: Book[]): Stored {
  return { version: 1, books, notes: [] };
}

function isStored(x: unknown): x is Stored {
  const s = x as Stored | null;
  return !!s && s.version === 1 && Array.isArray(s.books) && Array.isArray(s.notes);
}

/** Saved data wins; seed books added to the app later are merged in once, never duplicated. */
function read(storage: Storage | null, seedBooks: Book[]): Stored {
  if (!storage) return seed(seedBooks);
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (isStored(parsed)) {
        const have = new Set(parsed.books.map((b) => b.id));
        const missing = seedBooks.filter(
          (b) => !have.has(b.id) && !parsed.books.some((p) => actions.isSameBook(p, b)),
        );
        return missing.length
          ? { ...parsed, books: [...parsed.books, ...missing] }
          : parsed;
      }
    }
  } catch {
    /* fall through to a fresh seed */
  }
  return seed(seedBooks);
}

function write(storage: Storage | null, data: Stored): void {
  if (!storage) throw new Error("Storage is not available");
  storage.setItem(STORAGE_KEY, JSON.stringify(data));
}

/** Keeps everything on this device. Used until Supabase is connected. */
export class LocalBookRepository implements BookRepository {
  constructor(
    private readonly storage: Storage | null = defaultStorage(),
    private readonly seedBooks: Book[] = SEED_BOOKS,
  ) {}

  /** Nothing is shared, so there is nothing to protect. */
  readonly requiresPasscode: boolean = false;
  readonly storageLabel: string = "This device only";

  hasPasscode(): boolean {
    return true;
  }

  async unlock(code: string): Promise<boolean> {
    void code;
    return true;
  }

  lock(): void {}

  async listBooks(): Promise<Book[]> {
    return read(this.storage, this.seedBooks).books;
  }

  async listNotes(): Promise<BookNote[]> {
    return read(this.storage, this.seedBooks).notes;
  }

  async setStatus(bookId: string, status: ReadingStatus): Promise<void> {
    const d = read(this.storage, this.seedBooks);
    d.books = actions.setStatus(d.books, bookId, status, new Date().toISOString());
    write(this.storage, d);
  }

  async updateBook(bookId: string, edit: BookEdit): Promise<void> {
    const d = read(this.storage, this.seedBooks);
    d.books = actions.updateBook(d.books, bookId, edit, new Date().toISOString());
    write(this.storage, d);
  }

  async mergeBooks(keep: Pick<Book, "id">, drop: Pick<Book, "id" | "title" | "author">): Promise<void> {
    const d = read(this.storage, this.seedBooks);
    d.books = actions.mergeBooks(d.books, keep.id, drop.id, new Date().toISOString());
    d.notes = actions.mergeNotes(d.notes, keep.id, drop.id);
    write(this.storage, d);
  }

  async removeBook(book: Pick<Book, "id" | "title" | "author">): Promise<void> {
    const d = read(this.storage, this.seedBooks);
    d.books = actions.removeBook(d.books, book.id, new Date().toISOString());
    write(this.storage, d);
  }

  async restoreBook(bookId: string): Promise<void> {
    const d = read(this.storage, this.seedBooks);
    d.books = actions.restoreBook(d.books, bookId, new Date().toISOString());
    write(this.storage, d);
  }

  async setFavorite(bookId: string, favorite: boolean): Promise<void> {
    const d = read(this.storage, this.seedBooks);
    d.books = actions.setFavorite(d.books, bookId, favorite, new Date().toISOString());
    write(this.storage, d);
  }

  async addNote(bookId: string, body: string): Promise<BookNote> {
    const d = read(this.storage, this.seedBooks);
    const id = newId("note");
    d.notes = actions.addNote(d.notes, bookId, body, new Date().toISOString(), id);
    write(this.storage, d);
    const note = d.notes.find((n) => n.id === id);
    if (!note) throw new Error("Note was empty");
    return note;
  }

  async updateNote(noteId: string, body: string): Promise<void> {
    const d = read(this.storage, this.seedBooks);
    d.notes = actions.updateNote(d.notes, noteId, body, new Date().toISOString());
    write(this.storage, d);
  }

  async deleteNote(noteId: string): Promise<void> {
    const d = read(this.storage, this.seedBooks);
    d.notes = actions.deleteNote(d.notes, noteId);
    write(this.storage, d);
  }

  async addBook(input: NewBookInput): Promise<{ book: Book; created: boolean }> {
    const d = read(this.storage, this.seedBooks);
    const result = actions.addBookToLibrary(
      d.books,
      input,
      new Date().toISOString(),
      newId("bk"),
    );
    d.books = result.books;
    write(this.storage, d);
    return { book: result.book, created: result.created };
  }
}

function defaultStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}
