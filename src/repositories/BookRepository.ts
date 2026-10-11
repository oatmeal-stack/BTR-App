import type {
  Book,
  BookNote,
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

  listBooks(): Promise<Book[]>;
  /** Private notes. Empty until unlocked on a shared library. */
  listNotes(): Promise<BookNote[]>;
  setStatus(bookId: string, status: ReadingStatus): Promise<void>;
  setFavorite(bookId: string, favorite: boolean): Promise<void>;
  addNote(bookId: string, body: string): Promise<BookNote>;
  updateNote(noteId: string, body: string): Promise<void>;
  deleteNote(noteId: string): Promise<void>;
  addBook(input: NewBookInput): Promise<{ book: Book; created: boolean }>;
}
