"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Book, BookEdit, BookNote, BookTake, InboxNote, InboxStatus, ListItem, MyList, NewBookInput, NextItem, ReadingStatus, ReadRow } from "@/domain/book";
import * as actions from "@/domain/bookActions";
import * as listActions from "@/domain/listActions";
import * as readingActions from "@/domain/readingActions";
import { LockedOutError, PasscodeRequiredError } from "@/lib/passcode";
import { readAmazonLink, type AmazonResult } from "@/lib/amazon";
import { useIncludeRead } from "@/lib/prefs";
import { getRepository } from "@/repositories";
import type { BookRepository } from "@/repositories/BookRepository";

interface HomeState {
  pickId: string | null;
  forYouIds: string[];
}

/** How long the "Removed. Undo" bar stays up. */
export const UNDO_MS = 8000;

interface LibraryApi {
  /** The books you can see: removed ones are never in here, so nothing downstream can show them. */
  books: Book[];
  /** Removed books, most recently removed first (for the Removed books screen). */
  removedBooks: Book[];
  /** Find any book by id, removed or not (a removed book's link still opens, to say so and offer Restore). */
  findBook: (id: string) => Book | undefined;
  /** The book just removed, while its Undo bar is showing. */
  undoable: { id: string; title: string } | null;
  /** Saves everything on the Edit screen. */
  updateBook: (id: string, edit: BookEdit) => Promise<boolean>;
  /** Folds one copy of a book into another (the second is removed). */
  mergeBooks: (keepId: string, dropId: string) => Promise<boolean>;
  /** Your own lists, in order. Private: empty until signed in on the shared library. */
  lists: MyList[];
  listItems: ListItem[];
  /** Create a list. Returns its id, or the reason it couldn't be made (blank or already used). */
  createList: (name: string) => Promise<{ id: string } | { error: string }>;
  renameList: (id: string, name: string) => Promise<{ ok: true } | { error: string }>;
  /** Deletes the list only: every book on it stays in your library. */
  deleteList: (id: string) => Promise<boolean>;
  addToList: (listId: string, bookId: string) => Promise<boolean>;
  removeFromList: (listId: string, bookId: string) => Promise<boolean>;
  /** Puts many books on a list at once, in order. */
  addManyToList: (listId: string, bookIds: string[]) => Promise<boolean>;
  reorderList: (listId: string, bookIds: string[]) => Promise<boolean>;
  /** Drafts: rough notes about books to add later, newest first. Private. */
  drafts: InboxNote[];
  addDraft: (body: string) => Promise<boolean>;
  setDraftStatus: (id: string, status: InboxStatus, bookId?: string) => Promise<boolean>;
  /** The Next books queue (visible, still-unread books only), first in line first. */
  nextBooks: Book[];
  /** Raw queue entries, to tell whether a book is in it. */
  nextItems: NextItem[];
  addToNext: (bookId: string) => Promise<boolean>;
  removeFromNext: (bookId: string) => Promise<boolean>;
  reorderNext: (bookIds: string[]) => Promise<boolean>;
  /** The Start button: reading, from today. */
  startReading: (id: string) => Promise<boolean>;
  /** The Finish button: read today, with an optional rating and take. */
  finishReading: (id: string, details: { rating?: number; take?: string }) => Promise<boolean>;
  /** "My Take" on finished books. */
  takes: BookTake[];
  setTake: (id: string, body: string) => Promise<boolean>;
  /** Your finish date and star rating for a book (a blank clears it). */
  setReadDetails: (id: string, details: { finishedOn?: string; myRating?: number }) => Promise<boolean>;
  /** Marks many books read at once, with ratings, favorites and notes. */
  markManyRead: (rows: ReadRow[]) => Promise<boolean>;
  /** Reads an Amazon link (or ISBN) for its title, author, pages and cover. Suggestions only; nothing is saved. */
  lookupAmazon: (text: string) => Promise<AmazonResult>;
  removeBook: (id: string) => Promise<boolean>;
  restoreBook: (id: string) => Promise<boolean>;
  undoRemove: () => Promise<void>;
  notes: BookNote[];
  ready: boolean;
  /** True when the library could not be loaded at all. */
  loadFailed: boolean;
  notice: string | null;
  clearNotice: () => void;
  home: HomeState;
  shuffle: () => void;
  setStatus: (id: string, status: ReadingStatus) => Promise<boolean>;
  toggleFavorite: (id: string) => Promise<boolean>;
  addNote: (bookId: string, body: string, chapter?: string) => Promise<boolean>;
  /** A chapter left out keeps the note's chapter; a blank one clears it. */
  updateNote: (id: string, body: string, chapter?: string) => Promise<boolean>;
  deleteNote: (id: string) => Promise<boolean>;
  addBook: (input: NewBookInput) => Promise<{ book: Book; created: boolean } | null>;
  /** Where the library lives, and whether changes need a passcode that this device has. */
  storageLabel: string;
  requiresPasscode: boolean;
  unlocked: boolean;
  /** "locked" means too many wrong tries: the database is refusing every sign-in for a while. */
  unlock: (code: string) => Promise<UnlockResult>;
  lock: () => void;
}

interface Data {
  books: Book[];
  notes: BookNote[];
  lists: MyList[];
  items: ListItem[];
  inbox: InboxNote[];
  next: NextItem[];
  takes: BookTake[];
}

function newId(prefix: string): string {
  const rand =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${rand}`;
}

export type UnlockResult = "ok" | "wrong" | "locked" | "error";

const LibraryContext = createContext<LibraryApi | null>(null);

const SAVE_FAILED = "Couldn't save that. Your change was undone. Try again.";
const NEEDS_PASSCODE = "Enter your passcode in Profile to make changes.";
const LOAD_FAILED = "Couldn't load your library. Check your connection, then refresh.";

/** Books a random pick may choose: visible, and not already read unless you've said read books are fine. */
const pickable = (includeRead: boolean) => (b: Book) => actions.isActive(b) && (includeRead || b.status !== "read");

function makeHome(books: Book[], excludePick?: string | null): HomeState {
  const pick = actions.pickRandom(books, excludePick);
  return {
    pickId: pick?.id ?? null,
    forYouIds: actions.pickForYou(books, 4, pick?.id).map((b) => b.id),
  };
}

export function LibraryProvider({
  children,
  repository,
}: {
  children: ReactNode;
  repository?: BookRepository;
}) {
  const repo = useMemo(() => repository ?? getRepository(), [repository]);
  const [allBooks, setBooks] = useState<Book[]>([]);
  const [undoable, setUndoable] = useState<{ id: string; title: string } | null>(null);
  const [notes, setNotes] = useState<BookNote[]>([]);
  const [myLists, setMyLists] = useState<MyList[]>([]);
  const [listItems, setListItems] = useState<ListItem[]>([]);
  const [drafts, setDrafts] = useState<InboxNote[]>([]);
  const [nextItems, setNextItems] = useState<NextItem[]>([]);
  const [takes, setTakes] = useState<BookTake[]>([]);
  const [ready, setReady] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [home, setHome] = useState<HomeState>({ pickId: null, forYouIds: [] });
  const [unlocked, setUnlocked] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [includeRead] = useIncludeRead();
  const includeReadRef = useRef(includeRead);
  useEffect(() => {
    includeReadRef.current = includeRead;
  }, [includeRead]);
  const data = useRef<Data>({ books: [], notes: [], lists: [], items: [], inbox: [], next: [], takes: [] });

  /** Replaces whichever pieces are given and leaves the rest as they were. */
  const commit = useCallback((next: Partial<Data>) => {
    data.current = { ...data.current, ...next };
    setBooks(data.current.books);
    setNotes(data.current.notes);
    setMyLists(data.current.lists);
    setListItems(data.current.items);
    setDrafts(data.current.inbox);
    setNextItems(data.current.next);
    setTakes(data.current.takes);
  }, []);

  // Storage is only read after the page has loaded, so server and browser agree.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [b, n, mine] = await Promise.all([repo.listBooks(), repo.listNotes(), repo.listMyData()]);
        if (cancelled) return;
        commit({ books: b, notes: n, lists: mine.lists, items: mine.items, inbox: mine.inbox, next: mine.next, takes: mine.takes });
        setHome(makeHome(b.filter(pickable(includeReadRef.current))));
        setUnlocked(repo.hasPasscode());
      } catch {
        if (!cancelled) {
          setLoadFailed(true);
          setNotice(LOAD_FAILED);
        }
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [repo, commit]);

  /** Show the change at once; undo it and say so if saving fails. */
  const optimistic = useCallback(
    async (
      next: Partial<Data>,
      persist: () => Promise<void>,
    ): Promise<boolean> => {
      const prev = data.current;
      commit(next);
      try {
        await persist();
        return true;
      } catch (e) {
        commit(prev);
        if (e instanceof PasscodeRequiredError) {
          setUnlocked(false);
          setNotice(NEEDS_PASSCODE);
        } else {
          setNotice(SAVE_FAILED);
        }
        return false;
      }
    },
    [commit],
  );

  const setStatus = useCallback(
    async (id: string, status: ReadingStatus) => {
      const leavesQueue = status === "reading" || status === "read";
      const ok = await optimistic(
        {
          books: actions.setStatus(data.current.books, id, status, new Date().toISOString()),
          ...(leavesQueue ? { next: readingActions.removeFromNext(data.current.next, id) } : {}),
        },
        () => repo.setStatus(id, status),
      );
      // A book you've just read shouldn't stay up as the "next read" (unless read books are allowed).
      if (ok && status === "read" && !includeReadRef.current) {
        setHome((h) => (h.pickId === id || h.forYouIds.includes(id) ? makeHome(data.current.books.filter(pickable(false))) : h));
      }
      return ok;
    },
    [optimistic, repo],
  );

  const setReadDetails = useCallback(
    (id: string, details: { finishedOn?: string; myRating?: number }) =>
      optimistic({ books: actions.setReadDetails(data.current.books, id, details, new Date().toISOString()) }, () =>
        repo.setReadDetails(id, details),
      ),
    [optimistic, repo],
  );

  const nextBooks = useMemo(() => readingActions.nextQueue(allBooks, nextItems), [allBooks, nextItems]);

  const addToNext = useCallback(
    (bookId: string) => {
      const book = data.current.books.find((b) => b.id === bookId);
      if (!book || !readingActions.canQueue(book)) return Promise.resolve(false);
      return optimistic({ next: readingActions.addToNext(data.current.next, bookId) }, () => repo.addToNext(bookId));
    },
    [optimistic, repo],
  );

  const removeFromNext = useCallback(
    (bookId: string) => optimistic({ next: readingActions.removeFromNext(data.current.next, bookId) }, () => repo.removeFromNext(bookId)),
    [optimistic, repo],
  );

  const reorderNext = useCallback(
    (bookIds: string[]) => optimistic({ next: readingActions.reorderNext(data.current.next, bookIds) }, () => repo.reorderNext(bookIds)),
    [optimistic, repo],
  );

  const startReading = useCallback(
    (id: string) => {
      const on = readingActions.todayLocal();
      return optimistic(
        {
          books: readingActions.startReading(data.current.books, id, on, new Date().toISOString()),
          next: readingActions.removeFromNext(data.current.next, id),
        },
        () => repo.startReading(id, on),
      );
    },
    [optimistic, repo],
  );

  const finishReading = useCallback(
    async (id: string, details: { rating?: number; take?: string }) => {
      const on = readingActions.todayLocal();
      const now = new Date().toISOString();
      const ok = await optimistic(
        {
          books: readingActions.finishReading(data.current.books, id, { on, rating: details.rating }, now),
          next: readingActions.removeFromNext(data.current.next, id),
          takes: readingActions.setTake(data.current.takes, id, details.take ?? "", now),
        },
        () => repo.finishReading(id, { on, rating: details.rating, take: details.take }),
      );
      if (ok && !includeReadRef.current) {
        setHome((h) => (h.pickId === id || h.forYouIds.includes(id) ? makeHome(data.current.books.filter(pickable(false))) : h));
      }
      return ok;
    },
    [optimistic, repo],
  );

  const setTake = useCallback(
    (id: string, body: string) =>
      optimistic({ takes: readingActions.setTake(data.current.takes, id, body, new Date().toISOString()) }, () => repo.setTake(id, body)),
    [optimistic, repo],
  );

  const markManyRead = useCallback(
    (rows: ReadRow[]) => {
      const out = actions.markManyRead(data.current.books, data.current.notes, rows, new Date().toISOString());
      return optimistic({ books: out.books, notes: out.notes }, () => repo.markManyRead(rows));
    },
    [optimistic, repo],
  );

  const toggleFavorite = useCallback(
    (id: string) => {
      const current = data.current.books.find((b) => b.id === id);
      if (!current) return Promise.resolve(false);
      const favorite = !current.favorite;
      return optimistic(
        { books: actions.setFavorite(data.current.books, id, favorite, new Date().toISOString()) },
        () => repo.setFavorite(id, favorite),
      );
    },
    [optimistic, repo],
  );

  const addNote = useCallback(
    (bookId: string, body: string, chapter?: string) => {
      const text = body.trim();
      if (!text) return Promise.resolve(false);
      const tempId = `tmp-${Date.now()}`;
      const tag = readingActions.cleanChapter(chapter);
      return optimistic(
        { notes: actions.addNote(data.current.notes, bookId, text, new Date().toISOString(), tempId, tag) },
        async () => {
          const saved = await repo.addNote(bookId, text, tag);
          commit({
            books: data.current.books,
            notes: data.current.notes.map((n) => (n.id === tempId ? saved : n)),
          });
        },
      );
    },
    [optimistic, repo, commit],
  );

  const updateNote = useCallback(
    (id: string, body: string, chapter?: string) => {
      if (!body.trim()) return Promise.resolve(false);
      const tag = chapter === undefined ? undefined : (readingActions.cleanChapter(chapter) ?? "");
      return optimistic(
        { notes: actions.updateNote(data.current.notes, id, body, new Date().toISOString(), tag) },
        () => repo.updateNote(id, body, tag),
      );
    },
    [optimistic, repo],
  );

  const deleteNote = useCallback(
    (id: string) =>
      optimistic({ notes: actions.deleteNote(data.current.notes, id) }, () => repo.deleteNote(id)),
    [optimistic, repo],
  );

  const lists = useMemo(() => listActions.sortedLists(myLists), [myLists]);

  const createList = useCallback(
    async (name: string): Promise<{ id: string } | { error: string }> => {
      const problem = listActions.listNameProblem(data.current.lists, name);
      if (problem) return { error: problem };
      const id = newId("list");
      const ok = await optimistic(
        { lists: listActions.createList(data.current.lists, id, name, new Date().toISOString()) },
        () => repo.createList({ id, name: name.trim() }),
      );
      return ok ? { id } : { error: "Couldn't save the list. Try again." };
    },
    [optimistic, repo],
  );

  const renameList = useCallback(
    async (id: string, name: string): Promise<{ ok: true } | { error: string }> => {
      const problem = listActions.listNameProblem(data.current.lists, name, id);
      if (problem) return { error: problem };
      const ok = await optimistic({ lists: listActions.renameList(data.current.lists, id, name) }, () => repo.renameList(id, name.trim()));
      return ok ? { ok: true } : { error: "Couldn't rename the list. Try again." };
    },
    [optimistic, repo],
  );

  const deleteList = useCallback(
    (id: string) => optimistic(listActions.deleteList(data.current.lists, data.current.items, id), () => repo.deleteList(id)),
    [optimistic, repo],
  );

  const addToList = useCallback(
    (listId: string, bookId: string) =>
      optimistic({ items: listActions.addToList(data.current.items, listId, bookId) }, () => repo.addToList(listId, bookId)),
    [optimistic, repo],
  );

  const addManyToList = useCallback(
    (listId: string, bookIds: string[]) =>
      optimistic({ items: listActions.addManyToList(data.current.items, listId, bookIds) }, () => repo.addManyToList(listId, bookIds)),
    [optimistic, repo],
  );

  const removeFromList = useCallback(
    (listId: string, bookId: string) =>
      optimistic({ items: listActions.removeFromList(data.current.items, listId, bookId) }, () => repo.removeFromList(listId, bookId)),
    [optimistic, repo],
  );

  const reorderList = useCallback(
    (listId: string, bookIds: string[]) =>
      optimistic({ items: listActions.reorderList(data.current.items, listId, bookIds) }, () => repo.reorderList(listId, bookIds)),
    [optimistic, repo],
  );

  const addDraft = useCallback(
    (body: string) => {
      if (!body.trim()) return Promise.resolve(false);
      const id = newId("draft");
      return optimistic(
        { inbox: listActions.addDraft(data.current.inbox, id, body, new Date().toISOString()) },
        () => repo.addDraft({ id, body: body.trim() }),
      );
    },
    [optimistic, repo],
  );

  const setDraftStatus = useCallback(
    (id: string, status: InboxStatus, bookId?: string) =>
      optimistic({ inbox: listActions.setDraftStatus(data.current.inbox, id, status, bookId) }, () => repo.setDraftStatus(id, status, bookId)),
    [optimistic, repo],
  );

  const books = useMemo(() => allBooks.filter(actions.isActive), [allBooks]);
  const removedBooks = useMemo(
    () => allBooks.filter((b) => !actions.isActive(b)).sort((a, b) => (b.removedAt ?? "").localeCompare(a.removedAt ?? "")),
    [allBooks],
  );
  const findBook = useCallback((id: string) => allBooks.find((b) => b.id === id), [allBooks]);

  // The Undo bar goes away by itself.
  useEffect(() => {
    if (!undoable) return;
    const t = setTimeout(() => setUndoable(null), UNDO_MS);
    return () => clearTimeout(t);
  }, [undoable]);

  const updateBook = useCallback(
    (id: string, edit: BookEdit) =>
      optimistic({ books: actions.updateBook(data.current.books, id, edit, new Date().toISOString()) }, () =>
        repo.updateBook(id, edit),
      ),
    [optimistic, repo],
  );

  const mergeBooks = useCallback(
    (keepId: string, dropId: string) => {
      const keep = data.current.books.find((b) => b.id === keepId);
      const drop = data.current.books.find((b) => b.id === dropId);
      if (!keep || !drop) return Promise.resolve(false);
      const now = new Date().toISOString();
      return optimistic(
        {
          books: actions.mergeBooks(data.current.books, keepId, dropId, now),
          notes: actions.mergeNotes(data.current.notes, keepId, dropId),
        },
        () => repo.mergeBooks(keep, drop),
      );
    },
    [optimistic, repo],
  );

  const lookupAmazon = useCallback(
    (text: string) => readAmazonLink(text, { ask: repo.readAmazonLink ? (url) => repo.readAmazonLink!(url) : undefined }),
    [repo],
  );

  const removeBook = useCallback(
    async (id: string) => {
      const book = data.current.books.find((b) => b.id === id);
      if (!book || book.removedAt) return false;
      const ok = await optimistic(
        { books: actions.removeBook(data.current.books, id, new Date().toISOString()) },
        () => repo.removeBook(book),
      );
      if (ok) {
        setUndoable({ id, title: book.title });
        // If the book on the Home screen was the one removed, pick another so it doesn't linger.
        setHome((h) => (h.pickId === id || h.forYouIds.includes(id) ? makeHome(data.current.books.filter(pickable(includeReadRef.current))) : h));
      }
      return ok;
    },
    [optimistic, repo],
  );

  const restoreBook = useCallback(
    (id: string) =>
      optimistic({ books: actions.restoreBook(data.current.books, id, new Date().toISOString()) }, () => repo.restoreBook(id)),
    [optimistic, repo],
  );

  const undoRemove = useCallback(async () => {
    if (!undoable) return;
    const { id } = undoable;
    setUndoable(null);
    await restoreBook(id);
  }, [undoable, restoreBook]);

  const addBook = useCallback(
    async (input: NewBookInput) => {
      try {
        const result = await repo.addBook(input);
        commit({ books: await repo.listBooks(), notes: data.current.notes });
        return result;
      } catch (e) {
        if (e instanceof PasscodeRequiredError) {
          setUnlocked(false);
          setNotice(NEEDS_PASSCODE);
        } else {
          setNotice("Couldn't add that book. Try again.");
        }
        return null;
      }
    },
    [repo, commit],
  );

  const unlock = useCallback(
    async (code: string): Promise<UnlockResult> => {
      try {
        if (!(await repo.unlock(code))) return "wrong";
        setUnlocked(true);
        const [n, mine] = await Promise.all([repo.listNotes(), repo.listMyData()]);
        commit({ notes: n, lists: mine.lists, items: mine.items, inbox: mine.inbox, next: mine.next, takes: mine.takes });
        return "ok";
      } catch (e) {
        if (e instanceof LockedOutError) return "locked";
        setNotice("Couldn't check the passcode. Check your connection and try again.");
        return "error";
      }
    },
    [repo, commit],
  );

  const lock = useCallback(() => {
    repo.lock();
    setUnlocked(false);
    // Notes, lists and drafts are only visible while unlocked on a shared library.
    if (repo.requiresPasscode) commit({ notes: [], lists: [], items: [], inbox: [], next: [], takes: [] });
  }, [repo, commit]);

  const shuffle = useCallback(() => {
    setHome((h) => ({ ...h, ...makeHome(data.current.books.filter(pickable(includeReadRef.current)), h.pickId) }));
  }, []);

  const clearNotice = useCallback(() => setNotice(null), []);

  const value = useMemo<LibraryApi>(
    () => ({
      books,
      removedBooks,
      findBook,
      undoable,
      removeBook,
      restoreBook,
      undoRemove,
      lookupAmazon,
      nextBooks,
      nextItems,
      addToNext,
      removeFromNext,
      reorderNext,
      startReading,
      finishReading,
      takes,
      setTake,
      setReadDetails,
      markManyRead,
      lists,
      listItems,
      createList,
      renameList,
      deleteList,
      addToList,
      removeFromList,
      addManyToList,
      reorderList,
      drafts,
      addDraft,
      setDraftStatus,
      updateBook,
      mergeBooks,
      notes,
      ready,
      loadFailed,
      notice,
      clearNotice,
      home,
      shuffle,
      setStatus,
      toggleFavorite,
      addNote,
      updateNote,
      deleteNote,
      addBook,
      storageLabel: repo.storageLabel,
      requiresPasscode: repo.requiresPasscode,
      unlocked,
      unlock,
      lock,
    }),
    [books, removedBooks, findBook, undoable, removeBook, restoreBook, undoRemove, lookupAmazon, nextBooks, nextItems, addToNext, removeFromNext, reorderNext, startReading, finishReading, takes, setTake, setReadDetails, markManyRead, lists, listItems, createList, renameList, deleteList, addToList, removeFromList, addManyToList, reorderList, drafts, addDraft, setDraftStatus, updateBook, mergeBooks, notes, ready, loadFailed, notice, clearNotice, home, shuffle, setStatus, toggleFavorite, addNote, updateNote, deleteNote, addBook, repo, unlocked, unlock, lock],
  );

  return <LibraryContext.Provider value={value}>{children}</LibraryContext.Provider>;
}

export function useLibrary(): LibraryApi {
  const ctx = useContext(LibraryContext);
  if (!ctx) throw new Error("useLibrary must be used inside LibraryProvider");
  return ctx;
}
