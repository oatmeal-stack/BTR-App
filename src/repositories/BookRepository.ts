import type {
  Book,
  BookNote,
  BookEdit,
  InboxNote,
  InboxStatus,
  ListItem,
  MyList,
  NewBookInput,
  ReadingStatus,
} from "@/domain/book";

/** Everything private besides notes: your own lists, what is on them, and your drafts. */
export interface MyData {
  lists: MyList[];
  items: ListItem[];
  inbox: InboxNote[];
}

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
  /** Your lists and drafts. Empty until signed in on a shared library. */
  listMyData(): Promise<MyData>;
  createList(list: { id: string; name: string }): Promise<void>;
  renameList(id: string, name: string): Promise<void>;
  /** Deletes the list only: its books stay in the library. */
  deleteList(id: string): Promise<void>;
  addToList(listId: string, bookId: string): Promise<void>;
  removeFromList(listId: string, bookId: string): Promise<void>;
  reorderList(listId: string, bookIds: string[]): Promise<void>;
  addDraft(note: { id: string; body: string }): Promise<void>;
  setDraftStatus(id: string, status: InboxStatus, bookId?: string): Promise<void>;

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
