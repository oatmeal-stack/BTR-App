import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SEED_BOOKS } from "@/data/seedBooks";
import { isSameBook } from "@/domain/bookActions";
import { applyCovers, parseCovers } from "../../scripts/lib/covers";
import { buildBooks, checkTags, parsePsv, parseTags, SRC, toSeedSql } from "../../scripts/lib/seed";
import { GENRES, MOODS } from "@/domain/book";

const raw = (f: string) => parsePsv(readFileSync(join(process.cwd(), "data", "raw", f), "utf8"));
const tagsPath = join(process.cwd(), "data", "tags.psv");
const tags = existsSync(tagsPath) ? parseTags(readFileSync(tagsPath, "utf8")) : {};

const input = () => ({
  man: [...raw("man-book-club.psv"), ...raw("man-book-club-ranks-1-10.psv")],
  tgbc: raw("tough-guy-book-club.psv"),
  fantasy: raw("fantasy-top-100-uk.psv"),
  spy: raw("spy-novels-nyt.psv"),
  nyt: raw("nyt-50-thrillers.psv"),
  picks: raw("nyt-reader-picks.psv"),
  tags,
});

const built = buildBooks(input());
applyCovers(built.books, parseCovers(readFileSync(join(process.cwd(), "data", "covers.psv"), "utf8")));
const byTitle = (t: string) => built.books.filter((b) => b.title === t);

describe("import from the five lists", () => {
  it("every row of every list becomes a book tagged with that list", () => {
    const expected: Record<string, number> = {
      [SRC.man]: 165,
      [SRC.tgbc]: 100,
      [SRC.fantasy]: 100,
      [SRC.spy]: 117,
      [SRC.nyt]: 124, // the article's 50 plus 74 reader-recommended picks
    };
    for (const [source, n] of Object.entries(expected)) {
      expect(built.rowCounts[source]).toBe(n);
      expect(built.books.filter((b) => b.sources.some((s) => s.source === source))).toHaveLength(n);
    }
  });

  it("keeps Man Book Club ranks 1 to 165 each exactly once", () => {
    const ranks = built.books.flatMap((b) => b.sources.filter((s) => s.source === SRC.man).map((s) => s.rank));
    expect([...ranks].sort((a, b) => a! - b!)).toEqual(Array.from({ length: 165 }, (_, i) => i + 1));
  });

  it("merges books that are on several lists, so each shows up once", () => {
    expect(built.books.length).toBe(586);
    const long = byTitle("The Long Way to a Small, Angry Planet");
    expect(long).toHaveLength(1);
    expect(long[0].sources.map((s) => s.source).sort()).toEqual([SRC.fantasy, SRC.tgbc].sort());
    expect(byTitle("Slow Horses")[0].sources.map((s) => s.source).sort()).toEqual([SRC.nyt, SRC.spy].sort());
    expect(byTitle("The Sympathizer")[0].sources).toHaveLength(3);
  });

  it("never has two entries for the same book", () => {
    for (const b of built.books) {
      expect(built.books.filter((o) => isSameBook(o, b))).toHaveLength(1);
    }
    expect(new Set(built.books.map((b) => b.id)).size).toBe(built.books.length);
  });

  it("keeps different books that share a title", () => {
    const mww = built.books.filter((b) => b.title === "Men Without Women");
    expect(mww.map((b) => b.author).sort()).toEqual(["Ernest Hemingway", "Haruki Murakami"]);
  });

  it("prefers the fuller spelling when lists disagree", () => {
    expect(byTitle("The Lord of the Rings")).toHaveLength(1);
    expect(byTitle("The Lord of the Rings")[0].author).toBe("J.R.R. Tolkien");
    expect(built.books.find((b) => b.title.startsWith("The Long Way"))!.title).toContain("Small, Angry");
  });

  it("only gives a score to Man Book Club books that have one", () => {
    const scored = built.books.filter((b) => b.rating !== undefined);
    expect(scored).toHaveLength(158);
    expect(scored.every((b) => b.sources.some((s) => s.source === SRC.man))).toBe(true);
    expect(byTitle("Lonesome Dove")[0].rating).toBe(9);
    expect(byTitle("The Wide Wide Sea")[0].rating).toBeUndefined();
  });

  it("reads years out of the spy list notes and the NYT article", () => {
    expect(byTitle("Casino Royale")[0].year).toBe(1953);
    expect(byTitle("Casino Royale")[0].sourceNote).toContain("first Bond novel");
    expect(byTitle("Gone Girl")[0].year).toBe(2012);
    expect(byTitle("The Pearl")[0].year).toBe(1947);
  });

  it("starts every book as Want to read and not favorited", () => {
    expect(built.books.every((b) => b.status === "want_to_read" && !b.favorite)).toBe(true);
  });

  it("carries list notes and drops the redundant 'also read by' note", () => {
    expect(byTitle("The Pearl")[0].sourceNote).toContain("TGBC Camp book 2026");
    expect(byTitle("The Long Way to a Small, Angry Planet")[0].sourceNote ?? "").not.toMatch(/Also read by/);
  });

  it("flags series entries in the spy list", () => {
    expect(byTitle("Mitch Rapp series")[0].sourceNote).toContain("Series");
  });
});

describe("reader-recommended picks from the NYT comments", () => {
  const picks = raw("nyt-reader-picks.psv");
  const noteOf = (title: string) => byTitle(title)[0]?.sourceNote ?? "";

  it("only keeps books named by 2 or more different readers", () => {
    expect(picks).toHaveLength(74);
    for (const p of picks) expect(parseInt(p.Readers, 10)).toBeGreaterThanOrEqual(2);
  });

  it("does not store any reader's name", () => {
    expect(Object.keys(picks[0])).toEqual(["Title", "Author", "Kind", "Readers"]);
  });

  it("adds them to the NYT list with a note saying how many readers suggested them", () => {
    expect(noteOf("Kurt Wallander series")).toMatch(/Reader suggestion \(8 readers\)/);
    expect(noteOf("Kurt Wallander series")).toContain("Series, not a single title");
    expect(noteOf("Ian Rankin novels")).toContain("no specific title given");
    expect(byTitle("Bangkok 8")[0].sources).toEqual([{ source: SRC.nyt }]);
  });

  it("folds picks that are already in the library into the existing book", () => {
    for (const title of ["The Secret History", "Drive Your Plow Over the Bones of the Dead", "The Stand"]) {
      expect(byTitle(title)).toHaveLength(1);
    }
    expect(byTitle("The Secret History")[0].sources.map((s) => s.source).sort()).toEqual([SRC.nyt, SRC.tgbc].sort());
    expect(noteOf("The Secret History")).toContain("Reader suggestion");
    expect(byTitle("Bernie Gunther series")[0].sources).toHaveLength(2);
  });

  it("keeps a different book that happens to share a title", () => {
    const dogs = built.books.filter((b) => b.title === "The Power of the Dog");
    expect(dogs.map((b) => b.author).sort()).toEqual(["Don Winslow", "Thomas Savage"]);
  });

  it("never adds a pick the article already lists", () => {
    const nytArticle = raw("nyt-50-thrillers.psv").map((r) => r.Title);
    for (const p of picks) expect(nytArticle).not.toContain(p.Title);
  });
});

describe("genre, mood and author tags", () => {
  it("only use the fixed vocabulary and point at real books", () => {
    expect(checkTags(tags, built.books)).toEqual([]);
    for (const b of built.books) {
      for (const g of b.genres) expect(GENRES as readonly string[]).toContain(g);
      for (const m of b.moods) expect(MOODS as readonly string[]).toContain(m);
    }
  });

  it("cover almost every book, and leave unknown ones blank instead of guessing", () => {
    const withGenres = built.books.filter((b) => b.genres.length).length;
    expect(withGenres).toBeGreaterThanOrEqual(500);
    expect(built.books.length - withGenres).toBeLessThan(20);
    expect(byTitle("The Winner")[0].genres).toEqual([]);
    expect(byTitle("The In Crowd")[0].author).toBe("Vassell");
  });

  it("give every book at most 3 genres and 2 moods", () => {
    for (const b of built.books) {
      expect(b.genres.length).toBeLessThanOrEqual(3);
      expect(b.moods.length).toBeLessThanOrEqual(2);
    }
  });

  it("fill in full author names where a list only had a last name", () => {
    expect(byTitle("Lonesome Dove")[0].author).toBe("Larry McMurtry");
    expect(byTitle("The Feather Thief")[0].author).toBe("Kirk Wallace Johnson");
    expect(byTitle("Train Dreams")[0].author).toBe("Denis Johnson");
    expect(byTitle("Treasure Island")[0].author).toBe("Robert Louis Stevenson");
    expect(byTitle("Just Mercy")[0].author).toBe("Bryan Stevenson");
  });

  it("keep ids stable when an author name is filled in", () => {
    expect(byTitle("Lonesome Dove")[0].id).toBe("bk-lonesome-dove-mcmurtry");
  });

  it("leave only a handful of one-word authors", () => {
    const oneWord = built.books.filter((b) => b.author && !/\s/.test(b.author));
    expect(oneWord.map((b) => b.title).sort()).toEqual(
      ["Executive Hoodlum", "The In Crowd", "Shibumi", "The Winner", "Things Are Never So Bad They Can't Get Worse"].sort(),
    );
  });

  it("reject a tag that is not in the vocabulary", () => {
    const bad = parseTags("id|genres|moods|author\nbk-dune-herbert|Sci-fi;Zombies|Epic;Grumpy|\nbk-nope-x|Fantasy||");
    expect(checkTags(bad, built.books)).toEqual([
      'bk-dune-herbert: unknown genre "Zombies"',
      'bk-dune-herbert: unknown mood "Grumpy"',
      "Unknown book id: bk-nope-x",
    ]);
  });
});

describe("generated files", () => {
  it("the app's seedBooks.json is up to date with data/raw (re-run build-seed if this fails)", () => {
    expect(SEED_BOOKS).toEqual(JSON.parse(JSON.stringify(built.books)));
  });

  it("writes SQL that escapes quotes and keeps every book and source", () => {
    const sql = toSeedSql(built.books);
    expect(sql).toContain("begin;");
    expect(sql).toContain("commit;");
    expect(sql).toContain("'One Flew Over the Cuckoo''s Nest'");
    expect((sql.match(/^ \('bk-/gm) ?? []).length).toBe(586 + 606); // one tuple per book, one per list tag
    expect(sql).toContain("on conflict (id) do nothing");
    expect(sql).toContain("'{Epic,\"Slow burn\"}'"); // array values with spaces are quoted
  });

  it("can be split into chunks that together cover every book and list tag exactly once", () => {
    const size = 100;
    const chunks: string[] = [];
    for (let i = 0; i < built.books.length; i += size) chunks.push(toSeedSql(built.books, i, i + size));
    expect(chunks).toHaveLength(6);
    const tuples = chunks.reduce((n, c) => n + (c.match(/^ \('bk-/gm) ?? []).length, 0);
    expect(tuples).toBe(586 + 606);
    for (const c of chunks) {
      expect(c.startsWith("-- Generated")).toBe(true);
      expect(c).toContain("begin;");
      expect(c).toContain("commit;");
    }
  });

  it("refuses to write seed SQL for books that already have personal changes", () => {
    const changed = [{ ...built.books[0], favorite: true }];
    expect(() => toSeedSql(changed)).toThrow(/Want to read/);
  });
});
