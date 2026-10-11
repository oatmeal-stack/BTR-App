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
import type { Book, BookNote, NewBookInput, ReadingStatus } from "@/domain/book";
import * as actions from "@/domain/bookActions";
import { LockedOutError, PasscodeRequiredError } from "@/lib/passcode";
import { getRepository } from "@/repositories";
import type { BookRepository } from "@/repositories/BookRepository";

interface HomeState {
  pickId: string | null;
  forYouIds: string[];
}

interface LibraryApi {
  books: Book[];
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
  addNote: (bookId: string, body: string) => Promise<boolean>;
  updateNote: (id: string, body: string) => Promise<boolean>;
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

export type UnlockResult = "ok" | "wrong" | "locked" | "error";

const LibraryContext = createContext<LibraryApi | null>(null);

const SAVE_FAILED = "Couldn't save that. Your change was undone. Try again.";
const NEEDS_PASSCODE = "Enter your passcode in Profile to make changes.";
const LOAD_FAILED = "Couldn't load your library. Check your connection, then refresh.";

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
  const [books, setBooks] = useState<Book[]>([]);
  const [notes, setNotes] = useState<BookNote[]>([]);
  const [ready, setReady] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [home, setHome] = useState<HomeState>({ pickId: null, forYouIds: [] });
  const [unlocked, setUnlocked] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const data = useRef<{ books: Book[]; notes: BookNote[] }>({ books: [], notes: [] });

  const commit = useCallback((next: { books: Book[]; notes: BookNote[] }) => {
    data.current = next;
    setBooks(next.books);
    setNotes(next.notes);
  }, []);

  // Storage is only read after the page has loaded, so server and browser agree.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [b, n] = await Promise.all([repo.listBooks(), repo.listNotes()]);
        if (cancelled) return;
        commit({ books: b, notes: n });
        setHome(makeHome(b));
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
      next: { books?: Book[]; notes?: BookNote[] },
      persist: () => Promise<void>,
    ): Promise<boolean> => {
      const prev = data.current;
      commit({ books: next.books ?? prev.books, notes: next.notes ?? prev.notes });
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
    (id: string, status: ReadingStatus) =>
      optimistic(
        { books: actions.setStatus(data.current.books, id, status, new Date().toISOString()) },
        () => repo.setStatus(id, status),
      ),
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
    (bookId: string, body: string) => {
      const text = body.trim();
      if (!text) return Promise.resolve(false);
      const tempId = `tmp-${Date.now()}`;
      return optimistic(
        { notes: actions.addNote(data.current.notes, bookId, text, new Date().toISOString(), tempId) },
        async () => {
          const saved = await repo.addNote(bookId, text);
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
    (id: string, body: string) => {
      if (!body.trim()) return Promise.resolve(false);
      return optimistic(
        { notes: actions.updateNote(data.current.notes, id, body, new Date().toISOString()) },
        () => repo.updateNote(id, body),
      );
    },
    [optimistic, repo],
  );

  const deleteNote = useCallback(
    (id: string) =>
      optimistic({ notes: actions.deleteNote(data.current.notes, id) }, () => repo.deleteNote(id)),
    [optimistic, repo],
  );

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
        commit({ books: data.current.books, notes: await repo.listNotes() });
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
    // Private notes are only visible while unlocked on a shared library.
    if (repo.requiresPasscode) commit({ books: data.current.books, notes: [] });
  }, [repo, commit]);

  const shuffle = useCallback(() => {
    setHome((h) => ({ ...h, ...makeHome(data.current.books, h.pickId) }));
  }, []);

  const clearNotice = useCallback(() => setNotice(null), []);

  const value = useMemo<LibraryApi>(
    () => ({
      books,
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
    [books, notes, ready, loadFailed, notice, clearNotice, home, shuffle, setStatus, toggleFavorite, addNote, updateNote, deleteNote, addBook, repo, unlocked, unlock, lock],
  );

  return <LibraryContext.Provider value={value}>{children}</LibraryContext.Provider>;
}

export function useLibrary(): LibraryApi {
  const ctx = useContext(LibraryContext);
  if (!ctx) throw new Error("useLibrary must be used inside LibraryProvider");
  return ctx;
}
