import type { Book } from "./book";
import { isActive, normalizeText } from "./bookActions";
import { guessBookFromNote } from "./listActions";

/**
 * Turning a pasted list of books you've read into something you can review: one entry per line (with
 * your own verdict if you wrote one), and the books in your archive each line probably means.
 */

export interface ReadEntry {
  /** The line as pasted. */
  raw: string;
  title: string;
  author?: string;
  /** Whatever you wrote after the book ("loved - a favorite of all time"), kept as your note. */
  comment?: string;
  /** 1-5 stars, only when your words clearly say it (loved, liked, ok...). */
  rating?: number;
  /** True when you called it a favorite of all time. */
  favorite?: boolean;
}

/* ---------- reading the pasted lines ---------- */

/** What your words mean as stars. Only clear ones: anything else leaves the rating blank. */
export const VERDICT_STARS: [RegExp, number][] = [
  [/^(?:absolutely\s+)?(?:loved|love|adored|amazing|fantastic|favorite|favourite)\b/i, 5],
  [/^(?:really|very)\s+(?:liked|enjoyed|good)\b/i, 4],
  [/^(?:liked|enjoyed|good|great)\b/i, 4],
  [/^(?:ok|okay|fine|decent|so-so|mixed)\b/i, 3],
  [/^(?:meh|mediocre|disappointing|slow)\b/i, 2],
  [/^(?:did\s*n[o']t\s+like|disliked|hated|bad|awful|did\s*n[o']t\s+finish|dnf)\b/i, 1],
];

export function starsFromComment(comment: string | undefined): number | undefined {
  const c = comment?.trim();
  if (!c) return undefined;
  for (const [re, stars] of VERDICT_STARS) if (re.test(c)) return stars;
  return undefined;
}

const looksLikeVerdict = (s: string) => starsFromComment(s) !== undefined;

/** Strips list bullets and numbers ("1.", "-", "*", "•") from the front of a line. */
const unbullet = (line: string) => line.replace(/^\s*(?:[-*•·]|\d+[.)])\s+/, "").trim();

/**
 * One line, in any of the plain formats: "Title", "Title by Author", "Title - Author", "Title (Author)",
 * and either of the first two followed by a verdict after a dash: "Title by Author – loved".
 */
export function parseReadLine(raw: string): ReadEntry | null {
  const line = unbullet(raw);
  if (!line) return null;

  // A spaced dash may introduce your verdict, or separate title from author.
  const dash = line.match(/^(.+?)\s+[–—-]\s+(.+)$/);
  let main = line;
  let comment: string | undefined;
  if (dash) {
    const [, left, right] = dash;
    if (/\s+by\s+/i.test(left) || looksLikeVerdict(right)) {
      main = left;
      comment = right.trim();
    }
  }

  const guess = guessBookFromNote(main);
  let { title, author } = guess;
  if (!author) {
    const paren = main.match(/^(.+?)\s*\(([^)]{3,60})\)\s*$/);
    if (paren && !/series|trilogy|book \d/i.test(paren[2])) {
      title = paren[1].trim();
      author = paren[2].trim();
    }
  }
  if (!title) return null;
  const rating = starsFromComment(comment);
  const favorite = comment ? /\bfavou?rites?\b/i.test(comment) && /\b(all[- ]time|ever|of all)\b/i.test(comment) : false;
  return { raw: raw.trim(), title, author: author || undefined, comment, rating, favorite: favorite || undefined };
}

export function parseReadList(text: string): ReadEntry[] {
  return text
    .split(/\r?\n/)
    .map(parseReadLine)
    .filter((e): e is ReadEntry => e !== null);
}

/* ---------- finding each line in your archive ---------- */

const stripArticle = (t: string) => normalizeText(t).replace(/^(the|a|an) /, "");
const mainTitle = (t: string) => stripArticle(t.split(/\s*[:(]|\s+[-–—]\s/)[0]);
const bigrams = (s: string) => {
  const t = ` ${s} `;
  const out = new Map<string, number>();
  for (let i = 0; i < t.length - 1; i++) out.set(t.slice(i, i + 2), (out.get(t.slice(i, i + 2)) ?? 0) + 1);
  return out;
};

/** Dice similarity of two strings (0 to 1), forgiving of small spelling differences. */
export function similarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const x = bigrams(a);
  const y = bigrams(b);
  let shared = 0;
  let totalX = 0;
  let totalY = 0;
  for (const [g, n] of x) {
    shared += Math.min(n, y.get(g) ?? 0);
    totalX += n;
  }
  for (const n of y.values()) totalY += n;
  return (2 * shared) / (totalX + totalY);
}

/** The authors named on a line, split on "with", "and", "&" and commas ("Chuck Yeager with Leo Janos"). */
const authorNames = (author: string) =>
  author
    .split(/\s+(?:with|and)\s+|\s*&\s*|\s*,\s*/i)
    .map((n) => normalizeText(n).split(" ").filter(Boolean))
    .filter((w) => w.length);

/** Whether two author strings could be the same person: a last name in common, first initial agreeing. */
function sameAuthor(a: string, b: string): boolean {
  return authorNames(a).some((x) =>
    authorNames(b).some((y) => x[x.length - 1] === y[y.length - 1] && (x.length < 2 || y.length < 2 || x[0][0] === y[0][0])),
  );
}

export interface Candidate {
  book: Book;
  score: number;
}

export type Confidence = "high" | "low" | "none";

export interface ReadMatch {
  entry: ReadEntry;
  confidence: Confidence;
  /** Up to three books it might be, best first. */
  candidates: Candidate[];
}

/** A series ("The Dark Tower series") has no single book of that name; offer that author's books to choose from. */
const isSeries = (title: string) => /\b(series|saga|trilogy|chronicles|cycle|novels)\b/i.test(title);

export const HIGH_CONFIDENCE = 0.9;
const CANDIDATE_FLOOR = 0.7;

/**
 * Which books in the archive this line probably means. A confident match needs the title to match
 * (exactly, or the same apart from a subtitle) and no other book scoring nearly as well; anything else is
 * flagged for you to decide. A book removed earlier can still match (it will be restored).
 */
export function matchReadEntry(entry: ReadEntry, books: Book[]): ReadMatch {
  const want = stripArticle(entry.title);
  const wantMain = mainTitle(entry.title);
  const scored: Candidate[] = [];

  for (const book of books) {
    const got = stripArticle(book.title);
    const exact = got === want;
    const sameMain = exact || mainTitle(book.title) === wantMain;
    let score = exact ? 1 : sameMain ? 0.95 : similarity(got, want);
    if (entry.author && book.author) {
      if (sameAuthor(entry.author, book.author)) {
        if (score >= 0.7) score = Math.min(1, score + 0.05);
      } else if (!isSeries(entry.title)) {
        score *= 0.5; // right title, wrong author: probably a different book
      }
    }
    if (score >= CANDIDATE_FLOOR) scored.push({ book, score });
  }

  // "The Dark Tower series" has no single book of that name. Offer only that author's books to choose from,
  // closest title first; a look-alike title by someone else is no use.
  if (entry.author && isSeries(entry.title) && !scored.some((c) => c.score >= HIGH_CONFIDENCE)) {
    scored.length = 0;
    const wantWords = want.replace(/(series|saga|trilogy|chronicles|cycle|novels)/g, "").trim();
    for (const book of books) {
      if (book.author && sameAuthor(entry.author, book.author)) {
        scored.push({ book, score: Math.max(0.6, similarity(stripArticle(book.title), wantWords)) });
      }
    }
  }

  scored.sort((a, b) => b.score - a.score || Number(isActive(b.book)) - Number(isActive(a.book)));
  const candidates = scored.slice(0, 3);
  const [top, next] = candidates;
  const confident = top && top.score >= HIGH_CONFIDENCE && !(next && next.score >= top.score - 0.05);
  return { entry, confidence: confident ? "high" : candidates.length ? "low" : "none", candidates };
}

export function matchReadList(text: string, books: Book[]): ReadMatch[] {
  return parseReadList(text).map((e) => matchReadEntry(e, books));
}
