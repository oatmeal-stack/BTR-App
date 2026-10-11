import { describe, expect, it } from "vitest";
import type { Book } from "@/domain/book";
import { SEED_BOOKS } from "@/data/seedBooks";
import { SAMPLE_BOOKS } from "@/data/sampleBooks";
import {
  agreedYears,
  applyFacts,
  parseOlYears,
  parsePages,
  parseYears,
  toFactsSql,
  YEAR_AGREEMENT,
} from "../../scripts/lib/facts";

const copy = (): Book[] => SAMPLE_BOOKS.map((b) => ({ ...b, year: undefined, pageCount: undefined }));

describe("reading the looked-up facts", () => {
  it("reads pages and years, ignoring comments, blanks and junk", () => {
    expect(parsePages("# note\nbk-a|412\nbk-b|\nbk-c|lots\nbk-d|-5\n\nbk-e|1,200\nbk-f|88\n")).toEqual([
      { id: "bk-a", pages: 412 },
      { id: "bk-f", pages: 88 },
    ]);
    expect(parseYears("# note\nbk-a|1965\nbk-b|\nbk-c|soon\n")).toEqual([{ id: "bk-a", year: 1965 }]);
  });
});

describe("believing a looked-up year", () => {
  const wd = (rows: string) => parseYears(rows);

  it("reads Open Library's years from the facts file, for cross-checking only", () => {
    const ol = parseOlYears("# note\nbk-a|412|1965\nbk-b||1999\nbk-c|88|\nbk-d|10|junk\n");
    expect([...ol]).toEqual([
      ["bk-a", 1965],
      ["bk-b", 1999],
    ]);
    expect(parsePages("bk-a|412|1965\nbk-b||1999\nbk-c|88|")).toEqual([
      { id: "bk-a", pages: 412 },
      { id: "bk-c", pages: 88 },
    ]);
  });

  it("keeps a Wikidata year only when Open Library is within a couple of years of it", () => {
    const ol = new Map([
      ["close", 1966],
      ["exact", 1965],
      ["far", 1990],
    ]);
    const kept = agreedYears(wd("exact|1965\nclose|1965\nfar|1965"), ol);
    expect(kept.map((r) => r.id)).toEqual(["exact", "close"]);
    expect(YEAR_AGREEMENT).toBe(2);
    expect(agreedYears(wd("edge|1965"), new Map([["edge", 1965 + YEAR_AGREEMENT]]))).toHaveLength(1);
    expect(agreedYears(wd("edge|1965"), new Map([["edge", 1965 + YEAR_AGREEMENT + 1]]))).toHaveLength(0);
  });

  it("drops a year with nothing to check it against, or an absurd one even if both agree", () => {
    expect(agreedYears(wd("alone|1965"), new Map())).toEqual([]);
    expect(agreedYears(wd("old|1396"), new Map([["old", 1396]]))).toEqual([]);
  });
});

describe("putting facts on books", () => {
  it("fills blanks from the years and pages files together", () => {
    const books = copy();
    const [a] = books;
    applyFacts(books, [...parseYears(`${a.id}|1965`), ...parsePages(`${a.id}|612`)]);
    expect(books[0]).toMatchObject({ year: 1965, pageCount: 612 });
  });

  it("never replaces a year that came from your own lists, or a page count already there", () => {
    const books = copy();
    books[0].year = 1999;
    books[0].pageCount = 300;
    applyFacts(books, [{ id: books[0].id, year: 1965, pages: 612 }]);
    expect(books[0]).toMatchObject({ year: 1999, pageCount: 300 });
  });

  it("leaves a book alone when nothing was found for it", () => {
    const books = copy();
    applyFacts(books, [{ id: "bk-someone-else", year: 1900, pages: 100 }]);
    expect(books.every((b) => b.year === undefined && b.pageCount === undefined)).toBe(true);
  });
});

describe("the SQL that fills them on the live library", () => {
  it("only lists books that have something, and only fills blanks", () => {
    const books = copy();
    books[0].year = 1965;
    books[1].pageCount = 412;
    const sql = toFactsSql(books);
    expect(sql).toContain(`('${books[0].id}',1965,null)`);
    expect(sql).toContain(`('${books[1].id}',null,412)`);
    expect(sql).not.toContain(`'${books[2].id}'`);
    expect(sql).toMatch(/coalesce\(books\.year, v\.year\)/);
    expect(sql).toMatch(/coalesce\(books\.page_count, v\.pages\)/);
  });
});

describe("the seeded library's facts make sense", () => {
  it("has only plausible publication years and page counts", () => {
    const thisYear = new Date().getFullYear();
    for (const b of SEED_BOOKS) {
      if (b.year !== undefined) expect(b.year, `${b.title} year`).toBeGreaterThanOrEqual(1500);
      if (b.year !== undefined) expect(b.year, `${b.title} year`).toBeLessThanOrEqual(thisYear);
      if (b.pageCount !== undefined) {
        expect(b.pageCount, `${b.title} pages`).toBeGreaterThanOrEqual(40);
        expect(b.pageCount, `${b.title} pages`).toBeLessThanOrEqual(3000);
      }
    }
  });
});
