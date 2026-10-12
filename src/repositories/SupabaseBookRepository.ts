import {
  MY_ADDITIONS,
  type Book,
  type BookEdit,
  type BookNote,
  type InboxNote,
  type InboxStatus,
  type NewBookInput,
  type ReadingStatus,
  type ReadRow,
} from "@/domain/book";
import * as actions from "@/domain/bookActions";
import { browserPasscodeStore, LockedOutError, PasscodeRequiredError, type PasscodeStore } from "@/lib/passcode";
import type { BookRepository, MyData } from "./BookRepository";

/** The small part of the Supabase client this file uses (so tests can stand in for it). */
export interface DbError {
  message: string;
  code?: string;
}
export interface Db {
  from(table: string): {
    select(columns: string): {
      range(from: number, to: number): PromiseLike<{ data: unknown[] | null; error: DbError | null }>;
    };
  };
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: DbError | null }>;
}

interface BookRow {
  id: string;
  title: string;
  author: string | null;
  year: number | null;
  status: ReadingStatus;
  rating: number | string | null;
  cover_url: string | null;
  removed_at: string | null;
  page_count: number | null;
  finished_on: string | null;
  my_rating: number | null;
  source_note: string | null;
  favorite: boolean;
  genres: string[] | null;
  moods: string[] | null;
  created_at: string;
  updated_at: string;
}
interface SourceRow {
  book_id: string;
  source: string;
  rank: number | null;
}
interface MyDataRow {
  lists: { id: string; name: string; position: number; created_at: string }[];
  items: { list_id: string; book_id: string; position: number }[];
  inbox: { id: string; body: string; status: InboxStatus; book_id: string | null; created_at: string }[];
}
interface NoteRow {
  id: string;
  book_id: string;
  body: string;
  created_at: string;
  updated_at: string;
}

const PAGE = 1000;
const WRONG_PASSCODE = "28000";
const LOCKED_OUT = "P0423";

function newId(prefix: string): string {
  const rand =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${rand}`;
}

const toNote = (r: NoteRow): BookNote => ({
  id: r.id,
  bookId: r.book_id,
  body: r.body,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

/**
 * The shared library, stored in Supabase. Anyone can read it. Every change goes through a
 * database function that checks the passcode (see supabase/schema.sql).
 */
export class SupabaseBookRepository implements BookRepository {
  readonly requiresPasscode = true;
  readonly storageLabel = "Shared library (Supabase)";

  constructor(
    private readonly db: Db,
    private readonly passcode: PasscodeStore = browserPasscodeStore(),
  ) {}

  hasPasscode(): boolean {
    return Boolean(this.passcode.get());
  }

  async unlock(code: string): Promise<boolean> {
    // The database counts wrong tries and, after a few, refuses everything for a while. On success it
    // returns a login token; that token (not the passcode) is what this device keeps.
    const { data, error } = await this.db.rpc("login", { p_code: code });
    if (error) {
      if (error.code === LOCKED_OUT || /too many/i.test(error.message)) throw new LockedOutError();
      throw new Error(error.message);
    }
    if (typeof data !== "string" || !data) return false;
    this.passcode.set(data);
    return true;
  }

  lock(): void {
    const token = this.passcode.get();
    this.passcode.clear();
    if (token) void Promise.resolve(this.db.rpc("logout", { p_code: token })).catch(() => {});
  }

  /* ---------- reading ---------- */

  private async fetchAll<T>(table: string): Promise<T[]> {
    const rows: T[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await this.db.from(table).select("*").range(from, from + PAGE - 1);
      if (error) throw new Error(error.message);
      const page = (data ?? []) as T[];
      rows.push(...page);
      if (page.length < PAGE) return rows;
    }
  }

  async listBooks(): Promise<Book[]> {
    const [books, sources] = await Promise.all([
      this.fetchAll<BookRow>("books"),
      this.fetchAll<SourceRow>("book_sources"),
    ]);
    const bySource = new Map<string, SourceRow[]>();
    for (const s of sources) bySource.set(s.book_id, [...(bySource.get(s.book_id) ?? []), s]);

    return books.map((r) => ({
      id: r.id,
      title: r.title,
      author: r.author ?? undefined,
      year: r.year ?? undefined,
      status: r.status,
      rating: r.rating === null ? undefined : Number(r.rating),
      coverUrl: r.cover_url ?? undefined,
      removedAt: r.removed_at ?? undefined,
      pageCount: r.page_count ?? undefined,
      finishedOn: r.finished_on ? r.finished_on.slice(0, 10) : undefined, // a date, however the service writes it
      myRating: r.my_rating ?? undefined,
      sourceNote: r.source_note ?? undefined,
      favorite: r.favorite,
      genres: r.genres ?? [],
      moods: r.moods ?? [],
      sources: (bySource.get(r.id) ?? [])
        .sort((a, b) => a.source.localeCompare(b.source))
        .map((s) => ({ source: s.source, rank: s.rank ?? undefined })),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  async listNotes(): Promise<BookNote[]> {
    if (!this.hasPasscode()) return [];
    try {
      const rows = await this.call<NoteRow[]>("list_notes", {});
      return (rows ?? []).map(toNote);
    } catch (e) {
      if (e instanceof PasscodeRequiredError) return []; // the saved passcode no longer works
      throw e;
    }
  }

  /* ---------- changing (needs the passcode) ---------- */

  private async call<T = void>(fn: string, args: Record<string, unknown>): Promise<T> {
    const code = this.passcode.get();
    if (!code) throw new PasscodeRequiredError();
    const { data, error } = await this.db.rpc(fn, { p_code: code, ...args });
    if (error) {
      if (error.code === WRONG_PASSCODE || /wrong passcode/i.test(error.message)) {
        this.passcode.clear();
        throw new PasscodeRequiredError();
      }
      throw new Error(error.message);
    }
    return data as T;
  }

  async setStatus(bookId: string, status: ReadingStatus): Promise<void> {
    await this.call("set_status", { p_id: bookId, p_status: status });
  }

  async setFavorite(bookId: string, favorite: boolean): Promise<void> {
    await this.call("set_favorite", { p_id: bookId, p_favorite: favorite });
  }

  async updateBook(bookId: string, edit: BookEdit): Promise<void> {
    await this.call("update_book", {
      p_id: bookId,
      p_title: edit.title.trim(),
      p_author: edit.author?.trim() || null,
      p_year: edit.year ?? null,
      p_page_count: edit.pageCount ?? null,
      p_cover_url: edit.coverUrl?.trim() || null,
      p_genres: edit.genres,
      p_moods: edit.moods,
      p_source_note: edit.sourceNote?.trim() || null,
      p_sources: edit.sources,
    });
  }

  async mergeBooks(keep: Pick<Book, "id">, drop: Pick<Book, "id" | "title" | "author">): Promise<void> {
    await this.call("merge_books", {
      p_keep: keep.id,
      p_drop: drop.id,
      p_key: actions.importKey(drop.title, drop.author),
    });
  }

  async listMyData(): Promise<MyData> {
    const empty: MyData = { lists: [], items: [], inbox: [] };
    if (!this.hasPasscode()) return empty;
    try {
      const row = await this.call<MyDataRow>("list_my_data", {});
      return {
        lists: row.lists.map((l) => ({ id: l.id, name: l.name, position: l.position, createdAt: l.created_at })),
        items: row.items.map((i) => ({ listId: i.list_id, bookId: i.book_id, position: i.position })),
        inbox: row.inbox.map<InboxNote>((n) => ({
          id: n.id,
          body: n.body,
          status: n.status,
          bookId: n.book_id ?? undefined,
          createdAt: n.created_at,
        })),
      };
    } catch (e) {
      if (e instanceof PasscodeRequiredError) return empty; // the saved sign-in no longer works
      throw e;
    }
  }

  async createList(list: { id: string; name: string }): Promise<void> {
    await this.call("create_list", { p_id: list.id, p_name: list.name });
  }

  async renameList(id: string, name: string): Promise<void> {
    await this.call("rename_list", { p_id: id, p_name: name });
  }

  async deleteList(id: string): Promise<void> {
    await this.call("delete_list", { p_id: id });
  }

  async addToList(listId: string, bookId: string): Promise<void> {
    await this.call("add_to_list", { p_list_id: listId, p_book_id: bookId });
  }

  async addManyToList(listId: string, bookIds: string[]): Promise<void> {
    await this.call("add_many_to_list", { p_list_id: listId, p_book_ids: bookIds });
  }

  async removeFromList(listId: string, bookId: string): Promise<void> {
    await this.call("remove_from_list", { p_list_id: listId, p_book_id: bookId });
  }

  async reorderList(listId: string, bookIds: string[]): Promise<void> {
    await this.call("reorder_list", { p_list_id: listId, p_book_ids: bookIds });
  }

  async addDraft(note: { id: string; body: string }): Promise<void> {
    await this.call("add_inbox_note", { p_id: note.id, p_body: note.body });
  }

  async setDraftStatus(id: string, status: InboxStatus, bookId?: string): Promise<void> {
    await this.call("set_inbox_status", { p_id: id, p_status: status, p_book_id: bookId ?? null });
  }

  async setReadDetails(bookId: string, details: { finishedOn?: string; myRating?: number }): Promise<void> {
    await this.call("set_read_details", { p_id: bookId, p_finished_on: details.finishedOn ?? null, p_my_rating: details.myRating ?? null });
  }

  async markManyRead(rows: ReadRow[]): Promise<void> {
    await this.call("mark_read_bulk", {
      p_rows: rows.map((r) => ({
        id: r.id,
        my_rating: r.myRating ?? null,
        finished_on: r.finishedOn ?? null,
        favorite: r.favorite ?? null,
        note_id: r.noteId ?? null,
        note: r.note ?? null,
        restore: r.restore ?? false,
      })),
    });
  }

  async removeBook(book: Pick<Book, "id" | "title" | "author">): Promise<void> {
    // The key lets the database ignore this book if an import brings it back under another spelling.
    await this.call("remove_book", { p_id: book.id, p_key: actions.importKey(book.title, book.author) });
  }

  async restoreBook(bookId: string): Promise<void> {
    await this.call("restore_book", { p_id: bookId });
  }

  async addNote(bookId: string, body: string): Promise<BookNote> {
    const row = await this.call<NoteRow>("add_note", { p_id: newId("note"), p_book_id: bookId, p_body: body });
    return toNote(row);
  }

  async updateNote(noteId: string, body: string): Promise<void> {
    await this.call("update_note", { p_id: noteId, p_body: body });
  }

  async deleteNote(noteId: string): Promise<void> {
    await this.call("delete_note", { p_id: noteId });
  }

  /** Adds a new book, or folds it into the copy already in the library. */
  async addBook(input: NewBookInput): Promise<{ book: Book; created: boolean }> {
    const existing = await this.listBooks();
    const result = actions.addBookToLibrary(existing, input, new Date().toISOString(), newId("bk"));
    const sources = input.sources?.length ? input.sources : [{ source: MY_ADDITIONS }];

    if (result.created) {
      const [first, ...more] = sources;
      await this.call("add_book", {
        p_id: result.book.id,
        p_title: input.title.trim(),
        p_author: input.author?.trim() || null,
        p_year: input.year ?? null,
        p_note: input.note?.trim() || null,
        p_source: first.source,
        p_rank: first.rank ?? null,
      });
      for (const s of more) await this.merge(result.book.id, s.source, s.rank, undefined);
    } else {
      const own = input.sources?.length ? input.sources : [result.book.sources[0]];
      for (const s of own) await this.merge(result.book.id, s.source, s.rank, input.note);
    }
    return { book: result.book, created: result.created };
  }

  private merge(id: string, source: string, rank: number | undefined, note: string | undefined) {
    return this.call("merge_book", { p_id: id, p_source: source, p_rank: rank ?? null, p_note: note?.trim() || null });
  }
}
