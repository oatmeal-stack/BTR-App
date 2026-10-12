import type { Book, InboxNote, InboxStatus, ListItem, MyList } from "./book";
import { isActive, normalizeText } from "./bookActions";

/* ---------- your own lists ---------- */

/** A list name must be non-blank and not already used (ignoring case and spacing). Returns the problem, or null. */
export function listNameProblem(lists: MyList[], name: string, exceptId?: string): string | null {
  const wanted = name.trim();
  if (!wanted) return "Give the list a name.";
  const key = normalizeText(wanted);
  if (lists.some((l) => l.id !== exceptId && normalizeText(l.name) === key)) return "You already have a list with that name.";
  return null;
}

export function createList(lists: MyList[], id: string, name: string, now: string): MyList[] {
  if (listNameProblem(lists, name)) return lists;
  const position = lists.reduce((m, l) => Math.max(m, l.position), -1) + 1;
  return [...lists, { id, name: name.trim(), position, createdAt: now }];
}

export function renameList(lists: MyList[], id: string, name: string): MyList[] {
  if (listNameProblem(lists, name, id)) return lists;
  return lists.map((l) => (l.id === id ? { ...l, name: name.trim() } : l));
}

/** Deleting a list never deletes books: only the list and its memberships go. */
export function deleteList(lists: MyList[], items: ListItem[], id: string): { lists: MyList[]; items: ListItem[] } {
  return { lists: lists.filter((l) => l.id !== id), items: items.filter((i) => i.listId !== id) };
}

export function addToList(items: ListItem[], listId: string, bookId: string): ListItem[] {
  if (items.some((i) => i.listId === listId && i.bookId === bookId)) return items;
  const position = items.filter((i) => i.listId === listId).reduce((m, i) => Math.max(m, i.position), -1) + 1;
  return [...items, { listId, bookId, position }];
}

/** Puts several books on a list, after what's there, in the order given (a book already on it keeps its place). */
export function addManyToList(items: ListItem[], listId: string, bookIds: string[]): ListItem[] {
  return bookIds.reduce((acc, id) => addToList(acc, listId, id), items);
}

export function removeFromList(items: ListItem[], listId: string, bookId: string): ListItem[] {
  return items.filter((i) => !(i.listId === listId && i.bookId === bookId));
}

/** Puts a list's books in the given order (anything not named keeps its place at the end). */
export function reorderList(items: ListItem[], listId: string, bookIds: string[]): ListItem[] {
  const mine = items.filter((i) => i.listId === listId);
  const rest = mine.filter((i) => !bookIds.includes(i.bookId)).sort((a, b) => a.position - b.position).map((i) => i.bookId);
  const order = [...bookIds.filter((id) => mine.some((i) => i.bookId === id)), ...rest];
  const pos = new Map(order.map((id, n) => [id, n]));
  return items.map((i) => (i.listId === listId ? { ...i, position: pos.get(i.bookId) ?? i.position } : i));
}

/** The visible books on a list, in the list's own order. A removed book is skipped (it returns when restored). */
export function booksInList(books: Book[], items: ListItem[], listId: string): Book[] {
  const byId = new Map(books.filter(isActive).map((b) => [b.id, b]));
  return items
    .filter((i) => i.listId === listId)
    .sort((a, b) => a.position - b.position)
    .map((i) => byId.get(i.bookId))
    .filter((b): b is Book => b !== undefined);
}

export function listIdsForBook(items: ListItem[], bookId: string): string[] {
  return items.filter((i) => i.bookId === bookId).map((i) => i.listId);
}

/** How many visible books are on each list. */
export function listBookCounts(books: Book[], items: ListItem[], lists: MyList[]): Map<string, number> {
  return new Map(lists.map((l) => [l.id, booksInList(books, items, l.id).length]));
}

export function sortedLists(lists: MyList[]): MyList[] {
  return [...lists].sort((a, b) => a.position - b.position || a.createdAt.localeCompare(b.createdAt));
}

/* ---------- drafts: quick notes to turn into books later ---------- */

/** Saves a rough note exactly as typed (the text is never edited, trimmed only at the ends). */
export function addDraft(notes: InboxNote[], id: string, body: string, now: string): InboxNote[] {
  const text = body.trim();
  if (!text) return notes;
  return [{ id, body: text, status: "new", createdAt: now }, ...notes];
}

/** Marks a draft waiting, added (it became a book) or dismissed. The text itself is never changed. */
export function setDraftStatus(notes: InboxNote[], id: string, status: InboxStatus, bookId?: string): InboxNote[] {
  return notes.map((n) => (n.id === id ? { ...n, status, bookId: bookId ?? n.bookId } : n));
}

export const waitingDrafts = (notes: InboxNote[]) => notes.filter((n) => n.status === "new");

/**
 * A best guess at a title and author from a rough note, to pre-fill the Add form (you confirm it). It
 * only recognises plain patterns: "Title by Author", "Title - Author", and a quoted title. Anything else
 * becomes the title as written, which you can fix.
 */
export function guessBookFromNote(text: string): { title: string; author: string } {
  const line = (text.split(/\r?\n/).find((l) => l.trim()) ?? "").trim();
  const clean = (s: string) => s.replace(/^["“”'‘’\s]+|["“”'‘’\s.,;:!?]+$/g, "").trim();

  const quoted = line.match(/["“]([^"”]{2,120})["”](?:\s+(?:by|from)\s+(.+))?/i);
  if (quoted) return { title: clean(quoted[1]), author: clean(quoted[2] ?? "") };

  const by = line.match(/^(.{2,120}?)\s+by\s+(.{2,80})$/i);
  if (by) return { title: clean(by[1]), author: clean(by[2]) };

  const dash = line.match(/^(.{2,120}?)\s+[-–—]\s+(.{2,80})$/);
  if (dash) return { title: clean(dash[1]), author: clean(dash[2]) };

  return { title: clean(line).slice(0, 120), author: "" };
}
