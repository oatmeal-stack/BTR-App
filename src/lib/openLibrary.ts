import { normalizeText } from "@/domain/bookActions";

/**
 * Open Library lookups, shared by the import scripts and the app's "refresh cover and details" button.
 * Everything here is strict on purpose: a cover or a page count for the wrong book is worse than none,
 * so a result is only used when the title AND the author both agree.
 */

/** One result row from Open Library's search (only the fields we ask for). */
export interface OlDoc {
  key?: string;
  title?: string;
  author_name?: string[];
  cover_i?: number;
  edition_count?: number;
  first_publish_year?: number;
  number_of_pages_median?: number;
  /** Present when the search is asked for editions: the editions that matched (English ones, with language=eng). */
  editions?: { docs?: { cover_i?: number; language?: string[] }[] };
}

/** An English edition's jacket when the search found one, otherwise the work's general cover. */
export function bestCoverId(doc: OlDoc): number | undefined {
  const english = doc.editions?.docs?.find((e) => e.cover_i && e.language?.includes("eng"));
  return english?.cover_i ?? doc.cover_i;
}

const stripArticle = (t: string) => normalizeText(t).replace(/^(the|a|an) /, "");

/** The title before any subtitle: "Barbarian Days: A Surfing Life" -> "barbarian days". */
const mainTitle = (t: string) => stripArticle(t.split(/\s*[:(]|\s+[-–—]\s/)[0]);

/** Last word of the first author, normalised ("Cormac McCarthy" -> "mccarthy"). */
export function authorKey(author: string | undefined): string {
  const words = normalizeText(author ?? "").split(" ").filter(Boolean);
  return words[words.length - 1] ?? "";
}

/** First initial of the first author ("Frank Herbert" -> "f"), or "" when only a last name is known. */
function firstInitial(author: string | undefined): string {
  const words = normalizeText(author ?? "").split(" ").filter(Boolean);
  return words.length > 1 ? words[0][0] : "";
}

/** Same person, as far as names can tell: same last name, and the same first initial when both give one. */
function sameAuthor(want: string | undefined, got: string): boolean {
  if (authorKey(want) !== authorKey(got)) return false;
  const a = firstInitial(want);
  const b = firstInitial(got);
  return !a || !b || a === b;
}

/** An author listed only in another script (Japanese, Russian...) can't be compared to a Latin name. */
const unverifiableAuthor = (names: string[] | undefined) => !!names?.length && names.every((n) => !/[A-Za-z]/.test(n));

/**
 * Picks the Open Library result that is really this book, or null. BOTH must hold: the title matches
 * (equal, or one starts with the other so a subtitle doesn't break it) AND an author is the same person
 * (same last name and first initial, so Brian Herbert isn't Frank). Exact titles win; then the
 * most-catalogued work, which is usually the one people mean.
 * Pass `needsCover: false` when only the year or page count matters.
 */
export function pickMatch(
  title: string,
  author: string | undefined,
  docs: OlDoc[],
  options: { needsCover?: boolean } = {},
): OlDoc | null {
  const needsCover = options.needsCover ?? true;
  const want = stripArticle(title);
  const last = authorKey(author);
  if (!want || !last) return null;

  const scored: { doc: OlDoc; exact: boolean }[] = [];
  for (const doc of docs) {
    if (!doc.title) continue;
    if (needsCover && !bestCoverId(doc)) continue;
    const got = stripArticle(doc.title);
    const exact = got === want;
    // Or the same book with a subtitle on one side ("Barbarian Days: A Surfing Life"). Merely starting
    // with the same words isn't enough: "Dune Messiah" is not "Dune".
    const sameMain = mainTitle(doc.title) === mainTitle(title);
    if (!exact && !sameMain) continue;
    // A non-Latin author can't be checked, so only an EXACT title is trusted then.
    const authorOk =
      (doc.author_name ?? []).some((a) => sameAuthor(author, a)) || (exact && unverifiableAuthor(doc.author_name));
    if (!authorOk) continue;
    scored.push({ doc, exact });
  }
  scored.sort((a, b) => Number(b.exact) - Number(a.exact) || (b.doc.edition_count ?? 0) - (a.doc.edition_count ?? 0));
  return scored[0]?.doc ?? null;
}

export const coverUrl = (coverId: number) => `https://covers.openlibrary.org/b/id/${coverId}-M.jpg`;

/** A page count that isn't an obvious artifact (a 1-page "edition", a boxed set's thousands of pages). */
export function sanePageCount(n: number | undefined): number | undefined {
  return n !== undefined && Number.isInteger(n) && n >= 40 && n <= 3000 ? n : undefined;
}

/**
 * Likely authors for a book you only know the title of, most-catalogued first (up to 3). Only works whose
 * title is the same count. They are suggestions for you to accept, never filled in on their own.
 */
export async function suggestAuthors(title: string, fetcher: typeof fetch = fetch): Promise<string[]> {
  try {
    const qs = new URLSearchParams({ title, limit: "15", fields: "title,author_name,edition_count" });
    const res = await fetcher(`https://openlibrary.org/search.json?${qs}`);
    if (!res.ok) return [];
    const docs = (((await res.json()) as { docs?: OlDoc[] }).docs ?? []) as OlDoc[];
    const want = mainTitle(title);
    const seen = new Set<string>();
    return docs
      .filter((d) => d.title && mainTitle(d.title) === want && d.author_name?.[0] && /[A-Za-z]/.test(d.author_name[0]))
      .sort((a, b) => (b.edition_count ?? 0) - (a.edition_count ?? 0))
      .map((d) => d.author_name![0])
      .filter((a) => (seen.has(a.toLowerCase()) ? false : (seen.add(a.toLowerCase()), true)))
      .slice(0, 3);
  } catch {
    return [];
  }
}

export const SEARCH_FIELDS =
  "key,title,author_name,cover_i,edition_count,first_publish_year,number_of_pages_median,editions,editions.cover_i,editions.language";

export interface BookDetails {
  coverUrl?: string;
  year?: number;
  pageCount?: number;
}

/** What Open Library knows about this book, or nothing when no result is confidently the same book. */
export function detailsFrom(title: string, author: string | undefined, docs: OlDoc[]): BookDetails | null {
  const withCover = pickMatch(title, author, docs);
  const any = withCover ?? pickMatch(title, author, docs, { needsCover: false });
  if (!any) return null;
  const cover = withCover ? bestCoverId(withCover) : undefined;
  return {
    coverUrl: cover ? coverUrl(cover) : undefined,
    year: any.first_publish_year,
    pageCount: sanePageCount(any.number_of_pages_median),
  };
}

/** Looks the book up from the browser (Open Library allows this). Returns null when nothing matches or it can't be reached. */
export async function lookupDetails(
  title: string,
  author: string | undefined,
  fetcher: typeof fetch = fetch,
): Promise<BookDetails | null> {
  const last = author?.trim().split(/\s+/).pop() ?? "";
  const run = async (params: Record<string, string>) => {
    const qs = new URLSearchParams({ ...params, limit: "12", fields: SEARCH_FIELDS });
    const res = await fetcher(`https://openlibrary.org/search.json?${qs}`);
    if (!res.ok) throw new Error("search failed");
    return (((await res.json()) as { docs?: OlDoc[] }).docs ?? []) as OlDoc[];
  };
  try {
    // English editions first, so a Spanish or German jacket isn't picked for an English reader.
    let found = detailsFrom(title, author, await run({ title, ...(last ? { author: last } : {}), language: "eng" }));
    if (!found) found = detailsFrom(title, author, await run({ title, ...(last ? { author: last } : {}) }));
    if (!found) found = detailsFrom(title, author, await run({ q: `${title} ${last}`.trim() }));
    return found;
  } catch {
    return null;
  }
}
