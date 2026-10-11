import { GENRES, MOODS, type Book, type SourceTag } from "../../src/domain/book";
import { isSameBook } from "../../src/domain/bookActions";

/** Display names for the five lists. These are the values stored as sources. */
export const SRC = {
  tgbc: "Tough Guy Book Club",
  man: "Man Book Club",
  fantasy: "Fantasy Top 100 UK",
  spy: "NYT Spy Novels",
  nyt: "NYT 50 Thrillers",
} as const;

export type Row = Record<string, string>;

/** Reads the pipe-separated files in data/raw. First line is the header. */
export function parsePsv(text: string): Row[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  const [head, ...rest] = lines;
  const cols = head.split("|").map((s) => s.trim());
  return rest.map((line) => {
    const cells = line.split("|");
    const row: Row = {};
    cols.forEach((c, i) => {
      row[c] = (cells[i] ?? "").trim();
    });
    return row;
  });
}

export interface Candidate {
  title: string;
  author?: string;
  year?: number;
  rating?: number;
  notes: string[];
  source: SourceTag;
}

const num = (s: string): number | undefined => {
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n : undefined;
};

const clean = (...parts: (string | undefined)[]) =>
  parts.map((p) => p?.trim()).filter((p): p is string => Boolean(p));

export function fromToughGuy(rows: Row[]): Candidate[] {
  return rows.map((r) => ({
    title: r.Title,
    author: r.Author || undefined,
    year: num(r.Year),
    notes: clean(r.Status, r.Notes, r.DateRead ? `Read by TGBC ${r.DateRead}` : undefined),
    source: { source: SRC.tgbc },
  }));
}

export function fromManBookClub(rows: Row[]): Candidate[] {
  return rows.map((r) => {
    const rating = r.Rating && r.Rating !== "N/A" ? parseFloat(r.Rating) : undefined;
    return {
      title: r.Title,
      author: r.Author || undefined,
      rating: Number.isFinite(rating) ? rating : undefined,
      notes: clean(r.Status, r.Notes),
      source: { source: SRC.man, rank: num(r.Rank) },
    };
  });
}

export function fromFantasy(rows: Row[]): Candidate[] {
  return rows.map((r) => ({
    title: r.Title,
    author: r.Author || undefined,
    // "Also read by [[Tough Guy Book Club]]" just repeats what the source tags already show.
    notes: clean(r.Status, r.Notes.replace(/\[\[|\]\]/g, "")).filter((n) => !/^also read by/i.test(n)),
    source: { source: SRC.fantasy, rank: num(r.Rank) },
  }));
}

const SERIES = /\bseries\b|\(series\)|spy thrillers$/i;

export function fromSpy(rows: Row[]): Candidate[] {
  return rows.map((r) => {
    // Notes often start with the publication year, e.g. "1939; often cited as ...".
    const m = r.Notes.match(/^(\d{4})(?:;\s*(.*))?$/);
    return {
      title: r.Title,
      author: r.Author || undefined,
      year: m ? parseInt(m[1], 10) : undefined,
      notes: clean(
        r.Category,
        r.Status,
        m ? m[2] : r.Notes,
        r.ExtraNote,
        SERIES.test(r.Title) ? "Series, not a single title" : undefined,
      ),
      source: { source: SRC.spy },
    };
  });
}

export function fromNyt(rows: Row[]): Candidate[] {
  return rows.map((r) => ({
    title: r.Title,
    author: r.Author || undefined,
    year: num(r.Year),
    notes: [],
    source: { source: SRC.nyt, rank: num(r.Rank) },
  }));
}

/**
 * Books readers recommended in the NYT Thrillers comments, named by 2+ different readers
 * (see scripts/comment-picks.ts). They join the NYT list with a note, like the "Reader comment"
 * rows in the spy list. Rows: Title|Author|Kind|Readers.
 */
export function fromNytReaderPicks(rows: Row[]): Candidate[] {
  return rows.map((r) => {
    const n = parseInt(r.Readers, 10);
    const who = `Reader suggestion (${n} readers)`;
    const kindNote =
      r.Kind === "series"
        ? "Series, not a single title"
        : r.Kind === "author"
          ? "General recommendation, no specific title given"
          : undefined;
    return {
      title: r.Title,
      author: r.Author || undefined,
      notes: clean(who, kindNote),
      source: { source: SRC.nyt },
    };
  });
}

export interface MergedBook {
  title: string;
  author?: string;
  year?: number;
  rating?: number;
  notes: string[];
  sources: SourceTag[];
}

export interface MergeReport {
  books: MergedBook[];
  /** Same book listed twice inside one list (kept once). */
  repeatsWithinList: { source: string; title: string }[];
}

/** Longer wins: "Larry McMurtry" beats "McMurtry", "Small, Angry" beats "Small Angry". */
const fuller = (a?: string, b?: string) => ((b?.length ?? 0) > (a?.length ?? 0) ? b : a);

export function mergeCandidates(cands: Candidate[]): MergeReport {
  const books: MergedBook[] = [];
  const repeats: MergeReport["repeatsWithinList"] = [];

  for (const c of cands) {
    const hit = books.find((b) => isSameBook(b, c));
    if (!hit) {
      books.push({
        title: c.title,
        author: c.author,
        year: c.year,
        rating: c.rating,
        notes: [...c.notes],
        sources: [c.source],
      });
      continue;
    }
    if (hit.sources.some((s) => s.source === c.source.source)) {
      repeats.push({ source: c.source.source, title: c.title });
      continue;
    }
    hit.title = fuller(hit.title, c.title)!;
    hit.author = fuller(hit.author, c.author);
    hit.year ??= c.year;
    hit.rating ??= c.rating;
    for (const n of c.notes) if (!hit.notes.includes(n)) hit.notes.push(n);
    hit.sources.push(c.source);
  }
  return { books, repeatsWithinList: repeats };
}

/* ---------- final records ---------- */

export interface Tags {
  genres?: string[];
  moods?: string[];
  /** Full author name, when the list only gave a last name. */
  author?: string;
}

/** Reads data/tags.psv: id|genres;separated|moods;separated|full author (optional). */
export function parseTags(text: string): Record<string, Tags> {
  const split = (v: string) => v.split(";").map((x) => x.trim()).filter(Boolean);
  const out: Record<string, Tags> = {};
  for (const r of parsePsv(text)) {
    const id = r.id.startsWith("bk-") ? r.id : `bk-${r.id}`;
    out[id] = { genres: split(r.genres), moods: split(r.moods), author: r.author || undefined };
  }
  return out;
}

/** Problems that should stop the build: unknown ids, or values outside the fixed vocabulary. */
export function checkTags(tags: Record<string, Tags>, books: Book[]): string[] {
  const ids = new Set(books.map((b) => b.id));
  const problems: string[] = [];
  for (const [id, t] of Object.entries(tags)) {
    if (!ids.has(id)) problems.push(`Unknown book id: ${id}`);
    for (const g of t.genres ?? []) {
      if (!(GENRES as readonly string[]).includes(g)) problems.push(`${id}: unknown genre "${g}"`);
    }
    for (const m of t.moods ?? []) {
      if (!(MOODS as readonly string[]).includes(m)) problems.push(`${id}: unknown mood "${m}"`);
    }
  }
  return problems;
}

function lastWord(s: string): string {
  return (s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().match(/[a-z0-9]+/g) ?? []).pop() ?? "";
}

function slug(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Stable id from title + author last name, so re-running the import keeps ids. */
export function bookId(title: string, author?: string): string {
  return `bk-${slug(title.replace(/^(the|a|an)\s+/i, ""))}-${lastWord(author ?? "unknown")}`;
}

const BASE_TIME = Date.parse("2026-08-09T12:00:00.000Z");

export function toBooks(merged: MergedBook[], tags: Record<string, Tags> = {}): Book[] {
  const seen = new Set<string>();
  return merged.map((m, i) => {
    let id = bookId(m.title, m.author);
    for (let n = 2; seen.has(id); n++) id = `${bookId(m.title, m.author)}-${n}`;
    seen.add(id);
    const t = tags[id] ?? {};
    const stamp = new Date(BASE_TIME - i * 60_000).toISOString();
    return {
      id,
      title: m.title,
      author: t.author ?? m.author,
      year: m.year,
      status: "want_to_read",
      rating: m.rating,
      sourceNote: m.notes.length ? m.notes.join(" · ") : undefined,
      favorite: false,
      genres: t.genres ?? [],
      moods: t.moods ?? [],
      sources: m.sources,
      createdAt: stamp,
      updatedAt: stamp,
    };
  });
}

/** Everything the five lists contribute, merged. Order decides the first-seen spelling. */
export function buildBooks(input: {
  tgbc: Row[];
  man: Row[];
  fantasy: Row[];
  spy: Row[];
  nyt: Row[];
  /** Reader-recommended books from the NYT comments. Optional. */
  picks?: Row[];
  tags?: Record<string, Tags>;
}): { books: Book[]; repeatsWithinList: MergeReport["repeatsWithinList"]; rowCounts: Record<string, number> } {
  const cands = [
    ...fromManBookClub(input.man),
    ...fromToughGuy(input.tgbc),
    ...fromFantasy(input.fantasy),
    ...fromSpy(input.spy),
    ...fromNyt(input.nyt),
    ...fromNytReaderPicks(input.picks ?? []),
  ];
  const { books, repeatsWithinList } = mergeCandidates(cands);
  const rowCounts = {
    [SRC.man]: input.man.length,
    [SRC.tgbc]: input.tgbc.length,
    [SRC.fantasy]: input.fantasy.length,
    [SRC.spy]: input.spy.length,
    [SRC.nyt]: input.nyt.length + (input.picks?.length ?? 0),
  };
  return { books: toBooks(books, input.tags), repeatsWithinList, rowCounts };
}

/* ---------- SQL ---------- */

const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
const qOrNull = (s?: string) => (s ? q(s) : "null");
const numOrNull = (n?: number) => (n === undefined ? "null" : String(n));
/** A Postgres array literal like '{Epic,"Slow burn"}'. */
const arrayLiteral = (a: string[]) =>
  q(`{${a.map((x) => (/[\s,"{}\\]/.test(x) ? `"${x.replace(/(["\\])/g, "\\$1")}"` : x)).join(",")}}`);

const SEED_ORIGIN = "2026-08-09T12:00:00Z";

/**
 * Compact, re-runnable SQL for books[start, end). Each book's "added" time is its position in the
 * FULL list, so every chunk agrees on ordering. Existing rows are left alone.
 */
export function toSeedSql(books: Book[], start = 0, end = books.length): string {
  const slice = books.slice(start, end);
  if (slice.some((b) => b.status !== "want_to_read" || b.favorite)) {
    throw new Error("Seed books must all start as Want to read and not favorited");
  }
  const sourceKey = new Map<string, number>();
  for (const b of slice) for (const s of b.sources) if (!sourceKey.has(s.source)) sourceKey.set(s.source, sourceKey.size + 1);

  const bookRows = slice.map(
    (b, i) =>
      ` (${q(b.id)},${q(b.title)},${qOrNull(b.author)},${numOrNull(b.year)},${numOrNull(b.rating)},` +
      `${qOrNull(b.sourceNote)},${arrayLiteral(b.genres)},${arrayLiteral(b.moods)},${start + i})`,
  );
  const sourceRows = slice.flatMap((b) =>
    b.sources.map((s) => ` (${q(b.id)},${sourceKey.get(s.source)},${numOrNull(s.rank)})`),
  );
  const keyRows = [...sourceKey].map(([name, k]) => ` (${k},${q(name)})`);

  return [
    "-- Generated by scripts/build-seed.ts. Safe to re-run: existing rows are left alone.",
    "begin;",
    "insert into books (id, title, author, year, status, rating, source_note, favorite, genres, moods, created_at, updated_at)",
    `select v.id, v.title, v.author, v.year::int, 'want_to_read', v.rating::numeric, v.note, false, v.genres::text[], v.moods::text[], t.ts, t.ts`,
    "from (values",
    bookRows.join(",\n"),
    ") as v(id, title, author, year, rating, note, genres, moods, n),",
    `lateral (select '${SEED_ORIGIN}'::timestamptz - v.n * interval '1 minute' as ts) t`,
    "on conflict (id) do nothing;",
    "insert into book_sources (book_id, source, rank)",
    "select v.id, s.name, v.rank::int from (values",
    sourceRows.join(",\n"),
    ") as v(id, k, rank) join (values",
    keyRows.join(",\n"),
    ") as s(k, name) on s.k = v.k",
    "on conflict do nothing;",
    "commit;",
    "",
  ].join("\n");
}
