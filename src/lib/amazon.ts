import { asinFromUrl, isAmazonHost } from "../../supabase/functions/amazon-book/parse";
import { lookupDetails } from "./openLibrary";

/**
 * Adding a book from an Amazon link. What you paste can be a product link, a short share link from the
 * Amazon app (a.co/...), an ISBN, or the ten-character id. Whatever is found is a suggestion for the Add
 * form to show you: nothing is saved until you press Add.
 */

/* ---------- ISBNs ---------- */

export function isValidIsbn10(s: string): boolean {
  if (!/^\d{9}[\dXx]$/.test(s)) return false;
  const sum = [...s].reduce((t, c, i) => t + (c.toUpperCase() === "X" ? 10 : Number(c)) * (10 - i), 0);
  return sum % 11 === 0;
}

export function isValidIsbn13(s: string): boolean {
  if (!/^97[89]\d{10}$/.test(s)) return false;
  const sum = [...s].reduce((t, c, i) => t + Number(c) * (i % 2 === 0 ? 1 : 3), 0);
  return sum % 10 === 0;
}

/** The 13-digit form of a 10-digit ISBN (978 + the first nine digits + a new check digit). */
export function isbn10to13(isbn10: string): string | undefined {
  if (!isValidIsbn10(isbn10)) return undefined;
  const core = `978${isbn10.slice(0, 9)}`;
  const sum = [...core].reduce((t, c, i) => t + Number(c) * (i % 2 === 0 ? 1 : 3), 0);
  return `${core}${(10 - (sum % 10)) % 10}`;
}

/** The 10-digit form of a 978 ISBN-13 (there is none for 979). */
export function isbn13to10(isbn13: string): string | undefined {
  if (!isValidIsbn13(isbn13) || !isbn13.startsWith("978")) return undefined;
  const core = isbn13.slice(3, 12);
  const sum = [...core].reduce((t, c, i) => t + Number(c) * (10 - i), 0);
  const check = (11 - (sum % 11)) % 11;
  return `${core}${check === 10 ? "X" : check}`;
}

/* ---------- what was pasted ---------- */

export type AmazonInput =
  | { kind: "isbn"; isbn10?: string; isbn13?: string }
  /** A product id that isn't an ISBN (a Kindle edition, for instance). */
  | { kind: "asin"; asin: string }
  | { kind: "url"; url: string; asin?: string; isbn10?: string }
  /** a.co / amzn.to share links: only a server can follow these. */
  | { kind: "short"; url: string }
  | { kind: "none" };

const SHORT_HOSTS = new Set(["a.co", "amzn.to", "amzn.eu", "amzn.asia"]);

export function parseAmazonInput(text: string): AmazonInput {
  const raw = text.trim();
  if (!raw) return { kind: "none" };

  const compact = raw.replace(/[\s-]/g, "");
  if (/^(?:97[89]\d{10}|\d{9}[\dXx])$/.test(compact)) {
    if (isValidIsbn13(compact)) return { kind: "isbn", isbn13: compact, isbn10: isbn13to10(compact) };
    if (isValidIsbn10(compact)) return { kind: "isbn", isbn10: compact.toUpperCase(), isbn13: isbn10to13(compact.toUpperCase()) };
    return { kind: "none" };
  }
  if (/^B0[A-Z0-9]{8}$/i.test(compact)) return { kind: "asin", asin: compact.toUpperCase() };

  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return { kind: "none" };
  }
  if (!isAmazonHost(url.hostname)) return { kind: "none" };
  if (SHORT_HOSTS.has(url.hostname.toLowerCase())) return { kind: "short", url: url.toString() };
  const asin = asinFromUrl(url.toString());
  return { kind: "url", url: url.toString(), asin, isbn10: asin && isValidIsbn10(asin) ? asin.toUpperCase() : undefined };
}

/* ---------- titles ---------- */

/**
 * Amazon titles carry a subtitle and a series note: "Dungeon Crawler Carl: A LitRPG Adventure (Dungeon Crawler
 * Carl Book 1)". The short form ("Dungeon Crawler Carl") is what matches a book you already have.
 */
export function shortTitle(full: string): string {
  const noSeries = full.replace(/\s*\([^)]*\)\s*$/, "").trim();
  const main = noSeries.split(/\s*:\s+/)[0].trim();
  return main.length >= 2 ? main : noSeries || full.trim();
}

/* ---------- Open Library by ISBN ---------- */

export interface IsbnFacts {
  title?: string;
  author?: string;
  pages?: number;
  coverUrl?: string;
}

/** What Open Library knows about this exact edition (title, first author, pages, cover). */
export async function lookupByIsbn(isbn: string, fetcher: typeof fetch = fetch): Promise<IsbnFacts | null> {
  try {
    const res = await fetcher(`https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&format=json&jscmd=data`);
    if (!res.ok) return null;
    const rec = ((await res.json()) as Record<string, { title?: string; authors?: { name?: string }[]; number_of_pages?: number; cover?: { medium?: string } }>)[`ISBN:${isbn}`];
    if (!rec?.title) return null;
    const pages = rec.number_of_pages;
    return {
      title: rec.title,
      author: rec.authors?.[0]?.name,
      pages: pages && pages >= 10 && pages <= 5000 ? pages : undefined,
      coverUrl: rec.cover?.medium,
    };
  } catch {
    return null;
  }
}

/* ---------- putting it together ---------- */

/** What the server-side helper sends back for a link. */
export interface AmazonFunctionResult {
  asin?: string;
  finalUrl?: string;
  title?: string;
  author?: string;
  pages?: number;
  coverUrl?: string;
  isbn10?: string;
  isbn13?: string;
  blocked?: boolean;
  error?: string;
}

export interface AmazonBook {
  /** Short title, ready to match a book you already have. */
  title: string;
  /** Amazon's full title when it differs, so you can choose it instead. */
  fullTitle?: string;
  author?: string;
  pages?: number;
  coverUrl?: string;
  /** Amazon's product id, so the book can link straight to its page. */
  asin?: string;
  /** Where each fact came from, for the message shown to you. */
  from: { amazon: boolean; openLibrary: boolean };
}

export type AmazonResult =
  | { ok: true; book: AmazonBook }
  | { ok: false; reason: "unreadable" | "short-needs-signin" | "not-found" };

export interface AmazonDeps {
  fetcher?: typeof fetch;
  /** Asks the server-side helper to read a link (only available when signed in on the shared library). */
  ask?: (url: string) => Promise<AmazonFunctionResult | null>;
}

export async function readAmazonLink(text: string, deps: AmazonDeps = {}): Promise<AmazonResult> {
  const fetcher = deps.fetcher ?? fetch;
  const input = parseAmazonInput(text);
  if (input.kind === "none") return { ok: false, reason: "unreadable" };

  // The address the helper should read.
  const productUrl =
    input.kind === "url" || input.kind === "short"
      ? input.url
      : input.kind === "asin"
        ? `https://www.amazon.com/dp/${input.asin}`
        : `https://www.amazon.com/dp/${input.isbn10 ?? ""}`;
  const canAsk = Boolean(deps.ask) && (input.kind !== "isbn" || Boolean(input.isbn10));

  let page: AmazonFunctionResult | null = null;
  if (canAsk) {
    try {
      page = (await deps.ask!(productUrl)) ?? null;
    } catch {
      page = null;
    }
    if (page?.error) page = null;
  }
  if (input.kind === "short" && !page?.asin && !page?.title) {
    return { ok: false, reason: deps.ask ? "unreadable" : "short-needs-signin" };
  }

  const isbn =
    page?.isbn13 ?? page?.isbn10 ?? (input.kind === "isbn" ? input.isbn13 ?? input.isbn10 : undefined) ?? (input.kind === "url" ? input.isbn10 : undefined) ?? (page?.asin && isValidIsbn10(page.asin) ? page.asin : undefined);
  const edition = isbn ? await lookupByIsbn(isbn, fetcher) : null;

  const fullTitle = page?.title ?? edition?.title;
  if (!fullTitle) return { ok: false, reason: "not-found" };
  const title = shortTitle(fullTitle);
  const author = page?.author ?? edition?.author;
  let pages = page?.pages ?? edition?.pages;
  let coverUrl = page?.coverUrl ?? edition?.coverUrl;
  let usedOl = Boolean(!page?.pages && edition?.pages) || Boolean(!page?.coverUrl && edition?.coverUrl) || Boolean(!page && edition);

  // Still missing a cover or page count: a strict title + author search (never a guess).
  if ((!coverUrl || !pages) && author) {
    const found = await lookupDetails(title, author, fetcher);
    if (found) {
      if (!coverUrl && found.coverUrl) {
        coverUrl = found.coverUrl;
        usedOl = true;
      }
      if (!pages && found.pageCount) {
        pages = found.pageCount;
        usedOl = true;
      }
    }
  }

  const asin = page?.asin ?? (input.kind === "url" ? input.asin : input.kind === "asin" ? input.asin : input.kind === "isbn" ? input.isbn10 : undefined);
  return {
    ok: true,
    book: {
      title,
      fullTitle: fullTitle !== title ? fullTitle : undefined,
      author,
      pages,
      coverUrl,
      asin: asin?.toUpperCase(),
      from: { amazon: Boolean(page?.title || page?.pages || page?.coverUrl), openLibrary: usedOl || Boolean(edition) },
    },
  };
}
