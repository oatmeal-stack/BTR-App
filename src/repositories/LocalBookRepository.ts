import type { Book, BookEdit, BookNote, InboxNote, InboxStatus, ListItem, MyList, NewBookInput, ReadingStatus, ReadRow } from "@/domain/book";
import * as lists from "@/domain/listActions";
import * as actions from "@/domain/bookActions";
import { SEED_BOOKS } from "@/data/seedBooks";
import type { BookRepository, MyData } from "./BookRepository";

/** Versioned so a later schema change can migrate instead of breaking. */
export const STORAGE_KEY = "book-archive:v1";

interface Stored {
  version: 1;
  books: Book[];
  notes: BookNote[];
  /** Added later; older saved data won't have them, so they default to empty. */
  lists?: MyList[];
  items?: ListItem[];
  inbox?: InboxNote[];
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

  async listMyData(): Promise<MyData> {
    const d = read(this.storage, this.seedBooks);
    return { lists: d.lists ?? [], items: d.items ?? [], inbox: d.inbox ?? [] };
  }

  /** Reads, lets `change` edit the private data, and saves. */
  private editMine(change: (m: MyData) => MyData): void {
    const d = read(this.storage, this.seedBooks);
    const next = change({ lists: d.lists ?? [], items: d.items ?? [], inbox: d.inbox ?? [] });
    write(this.storage, { ...d, ...next });
  }

  async createList(list: { id: string; name: string }): Promise<void> {
    this.editMine((m) => ({ ...m, lists: lists.createList(m.lists, list.id, list.name, new Date().toISOString()) }));
  }

  async renameList(id: string, name: string): Promise<void> {
    this.editMine((m) => ({ ...m, lists: lists.renameList(m.lists, id, name) }));
  }

  async deleteList(id: string): Promise<void> {
    this.editMine((m) => ({ ...m, ...lists.deleteList(m.lists, m.items, id) }));
  }

  async addToList(listId: string, bookId: string): Promise<void> {
    this.editMine((m) => ({ ...m, items: lists.addToList(m.items, listId, bookId) }));
  }

  async addManyToList(listId: string, bookIds: string[]): Promise<void> {
    this.editMine((m) => ({ ...m, items: lists.addManyToList(m.items, listId, bookIds) }));
  }

  async removeFromList(listId: string, bookId: string): Promise<void> {
    this.editMine((m) => ({ ...m, items: lists.removeFromList(m.items, listId, bookId) }));
  }

  async reorderList(listId: string, bookIds: string[]): Promise<void> {
    this.editMine((m) => ({ ...m, items: lists.reorderList(m.items, listId, bookIds) }));
  }

  async addDraft(note: { id: string; body: string }): Promise<void> {
    this.editMine((m) => ({ ...m, inbox: lists.addDraft(m.inbox, note.id, note.body, new Date().toISOString()) }));
  }

  async setDraftStatus(id: string, status: InboxStatus, bookId?: string): Promise<void> {
    this.editMine((m) => ({ ...m, inbox: lists.setDraftStatus(m.inbox, id, status, bookId) }));
  }

  async setReadDetails(bookId: string, details: { finishedOn?: string; myRating?: number }): Promise<void> {
    const d = read(this.storage, this.seedBooks);
    d.books = actions.setReadDetails(d.books, bookId, details, new Date().toISOString());
    write(this.storage, d);
  }

  async markManyRead(rows: ReadRow[]): Promise<void> {
    const d = read(this.storage, this.seedBooks);
    const out = actions.markManyRead(d.books, d.notes, rows, new Date().toISOString());
    write(this.storage, { ...d, books: out.books, notes: out.notes });
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
