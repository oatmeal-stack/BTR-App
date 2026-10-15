import type { Book, BookNote, BookTake, NextItem } from "./book";
import { isActive, normalizeTitle } from "./bookActions";

/**
 * Reading now, the Next books queue, and finishing. Pure functions, like the rest of the domain: the
 * screens and both stores (this device and Supabase) lean on the same rules.
 */

/** Today's calendar day on this device (YYYY-MM-DD). Start and Finish use the phone's own day, not the server's. */
export function todayLocal(now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

/** "Oct 15, 2026" for a YYYY-MM-DD day (read as that calendar day, never shifted by a time zone). */
export function dayLabel(day: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return day;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/* ---------- currently reading ---------- */

/**
 * The books you're reading right now: every visible book whose status is Reading. Started ones come first
 * (the one you started longest ago leads); books not started yet follow, A to Z.
 */
export function readingNow(books: Book[]): Book[] {
  const byTitle = (a: Book, b: Book) => normalizeTitle(a.title).localeCompare(normalizeTitle(b.title));
  return books
    .filter((b) => isActive(b) && b.status === "reading")
    .sort((a, b) => {
      if (a.startedOn && b.startedOn) return a.startedOn.localeCompare(b.startedOn) || byTitle(a, b);
      if (a.startedOn) return -1;
      if (b.startedOn) return 1;
      return byTitle(a, b);
    });
}

/** The Start button: reading, from this day. */
export function startReading(books: Book[], id: string, on: string, now: string): Book[] {
  return books.map((b) => (b.id === id ? { ...b, status: "reading" as const, startedOn: on, updatedAt: now } : b));
}

export interface FinishDetails {
  /** The day it was finished (YYYY-MM-DD). */
  on: string;
  /** 1 to 5 stars, or left out. */
  rating?: number;
}

/** The Finish button: read, on this day, with an optional rating. The start date is left alone. */
export function finishReading(books: Book[], id: string, details: FinishDetails, now: string): Book[] {
  const stars = details.rating !== undefined && details.rating >= 1 && details.rating <= 5 ? Math.round(details.rating) : undefined;
  return books.map((b) =>
    b.id === id ? { ...b, status: "read" as const, finishedOn: details.on, myRating: stars, updatedAt: now } : b,
  );
}

/** Writes or clears (blank) the take on a book. */
export function setTake(takes: BookTake[], bookId: string, body: string, now: string): BookTake[] {
  const text = body.trim();
  const rest = takes.filter((t) => t.bookId !== bookId);
  return text ? [...rest, { bookId, body: text, updatedAt: now }] : rest;
}

export const takeFor = (takes: BookTake[], bookId: string): BookTake | undefined => takes.find((t) => t.bookId === bookId);

/** Finished books, the most recently finished first. Ones with no date follow, A to Z. */
export function finishedBooks(books: Book[]): Book[] {
  const byTitle = (a: Book, b: Book) => normalizeTitle(a.title).localeCompare(normalizeTitle(b.title));
  return books
    .filter((b) => isActive(b) && b.status === "read")
    .sort((a, b) => {
      if (a.finishedOn && b.finishedOn) return b.finishedOn.localeCompare(a.finishedOn) || byTitle(a, b);
      if (a.finishedOn) return -1;
      if (b.finishedOn) return 1;
      return byTitle(a, b);
    });
}

/* ---------- next books (a ranked queue) ---------- */

/** A book can wait in the queue only while it is visible and not already being read or read. */
export const canQueue = (b: Book): boolean => isActive(b) && (b.status === "want_to_read" || b.status === "abandoned");

/** The queue, first in line first. Anything that can't be queued any more (started, read, removed) is left out. */
export function nextQueue(books: Book[], next: NextItem[]): Book[] {
  const byId = new Map(books.filter(canQueue).map((b) => [b.id, b]));
  const seen = new Set<string>();
  const out: Book[] = [];
  for (const item of [...next].sort((a, b) => a.position - b.position)) {
    const book = byId.get(item.bookId);
    if (!book || seen.has(book.id)) continue;
    seen.add(book.id);
    out.push(book);
  }
  return out;
}

export const isQueued = (next: NextItem[], bookId: string): boolean => next.some((n) => n.bookId === bookId);

const renumber = (ids: string[]): NextItem[] => ids.map((bookId, position) => ({ bookId, position }));
const orderOf = (next: NextItem[]): string[] => [...next].sort((a, b) => a.position - b.position).map((n) => n.bookId);

/** Puts a book at the end of the queue (nothing changes if it's already there). */
export function addToNext(next: NextItem[], bookId: string): NextItem[] {
  if (isQueued(next, bookId)) return next;
  return renumber([...orderOf(next), bookId]);
}

export function removeFromNext(next: NextItem[], bookId: string): NextItem[] {
  return renumber(orderOf(next).filter((id) => id !== bookId));
}

/** The queue in this order; anything not named keeps its relative order after these. */
export function reorderNext(next: NextItem[], bookIds: string[]): NextItem[] {
  const have = new Set(next.map((n) => n.bookId));
  const named = bookIds.filter((id, i) => have.has(id) && bookIds.indexOf(id) === i);
  const rest = orderOf(next).filter((id) => !named.includes(id));
  return renumber([...named, ...rest]);
}

/** Moves the book at `index` one place up (-1) or down (1). */
export function moveInOrder(ids: string[], index: number, by: -1 | 1): string[] {
  const to = index + by;
  if (index < 0 || index >= ids.length || to < 0 || to >= ids.length) return ids;
  const copy = [...ids];
  [copy[index], copy[to]] = [copy[to], copy[index]];
  return copy;
}

/* ---------- notes while reading ---------- */

/**
 * Notes in the order they were written (oldest first), so a reading journal reads top to bottom. Two notes with
 * the same timestamp keep the order they arrived in (the sort is stable), never a random one.
 */
export function notesInOrder(notes: BookNote[]): BookNote[] {
  return [...notes].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** "ch. 12", "Part Two", "p. 88": trimmed, one line, not too long. Blank means no chapter. */
export function cleanChapter(text: string | undefined): string | undefined {
  const t = (text ?? "").replace(/\s+/g, " ").trim().slice(0, 60);
  return t || undefined;
}

export type NotePiece = { kind: "text"; text: string } | { kind: "link"; text: string; href: string };

const URL_PATTERN = /\b(?:https?:\/\/|www\.)[^\s<>"]+/gi;

/** Trailing punctuation is part of the sentence, not the link; a closing bracket stays only if the link opens one. */
function trimLink(raw: string): string {
  let url = raw;
  for (;;) {
    const last = url[url.length - 1];
    if (last && ".,;:!?'’”*".includes(last)) url = url.slice(0, -1);
    else if (last === ")" && (url.match(/\(/g)?.length ?? 0) < (url.match(/\)/g)?.length ?? 0)) url = url.slice(0, -1);
    else if (last === "]" && (url.match(/\[/g)?.length ?? 0) < (url.match(/\]/g)?.length ?? 0)) url = url.slice(0, -1);
    else return url;
  }
}

/**
 * Splits a note into plain text and web links (websites, YouTube...) so the links can be tapped. Only http and
 * https links are ever made clickable; the text is never changed, so putting the pieces back together gives the
 * note exactly as it was typed.
 */
export function linkify(text: string): NotePiece[] {
  const pieces: NotePiece[] = [];
  let at = 0;
  for (const m of text.matchAll(URL_PATTERN)) {
    const start = m.index ?? 0;
    const raw = trimLink(m[0]);
    const href = raw.toLowerCase().startsWith("www.") ? `https://${raw}` : raw;
    let ok = false;
    try {
      const u = new URL(href);
      ok = (u.protocol === "http:" || u.protocol === "https:") && u.hostname.includes(".");
    } catch {
      ok = false;
    }
    if (!ok) continue;
    if (start > at) pieces.push({ kind: "text", text: text.slice(at, start) });
    pieces.push({ kind: "link", text: raw, href });
    at = start + raw.length;
  }
  if (at < text.length) pieces.push({ kind: "text", text: text.slice(at) });
  return pieces.length ? pieces : [{ kind: "text", text }];
}
