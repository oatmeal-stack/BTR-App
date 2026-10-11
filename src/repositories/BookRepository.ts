import type {
  Book,
  BookNote,
  BookEdit,
  NewBookInput,
  ReadingStatus,
} from "@/domain/book";

/**
 * Everything the app needs from storage. The screens only know this
 * interface, so the this-device store and the shared Supabase store are
 * interchangeable without touching any screen.
 */
export interface BookRepository {
  /** True when changes need the passcode (the shared library). */
  readonly requiresPasscode: boolean;
  /** Shown on the Profile screen: where the library lives. */
  readonly storageLabel: string;
  /** Whether a passcode is remembered on this device (it may still turn out to be wrong). */
  hasPasscode(): boolean;
  /** Checks a passcode and remembers it on this device if it's right. */
  unlock(code: string): Promise<boolean>;
  /** Forgets the passcode on this device. */
  lock(): void;

  /** Every book, including removed ones (they carry `removedAt`). The app hides those itself. */
  listBooks(): Promise<Book[]>;
  /** Private notes. Empty until unlocked on a shared library. */
  listNotes(): Promise<BookNote[]>;
  setStatus(bookId: string, status: ReadingStatus): Promise<void>;
  setFavorite(bookId: string, favorite: boolean): Promise<void>;
  /** Saves everything the Edit screen changes (see BookEdit). */
  updateBook(bookId: string, edit: BookEdit): Promise<void>;
  /** Folds the second copy into the first: lists, notes, tags and gaps move over; the second is removed. */
  mergeBooks(keep: Pick<Book, "id">, drop: Pick<Book, "id" | "title" | "author">): Promise<void>;
  /** Hides a book everywhere without deleting anything. A re-import will not bring it back. */
  removeBook(book: Pick<Book, "id" | "title" | "author">): Promise<void>;
  /** Brings a removed book back exactly as it was. */
  restoreBook(bookId: string): Promise<void>;
  addNote(bookId: string, body: string): Promise<BookNote>;
  updateNote(noteId: string, body: string): Promise<void>;
  deleteNote(noteId: string): Promise<void>;
  addBook(input: NewBookInput): Promise<{ book: Book; created: boolean }>;
}
