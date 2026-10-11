import { describe, expect, it } from "vitest";
import { detailsFrom, lookupDetails, pickMatch, sanePageCount, type OlDoc } from "@/lib/openLibrary";

const doc = (over: Partial<OlDoc>): OlDoc => ({
  title: "Dune",
  author_name: ["Frank Herbert"],
  cover_i: 11,
  edition_count: 400,
  first_publish_year: 1965,
  number_of_pages_median: 612,
  ...over,
});

describe("year and page count from Open Library", () => {
  it("takes year and pages from the matching book, and the cover too", () => {
    expect(detailsFrom("Dune", "Frank Herbert", [doc({})])).toEqual({
      coverUrl: "https://covers.openlibrary.org/b/id/11-M.jpg",
      year: 1965,
      pageCount: 612,
    });
  });

  it("still gives the year and pages when the matching book has no cover", () => {
    const d = detailsFrom("Dune", "Frank Herbert", [doc({ cover_i: undefined })]);
    expect(d).toEqual({ coverUrl: undefined, year: 1965, pageCount: 612 });
    expect(pickMatch("Dune", "Frank Herbert", [doc({ cover_i: undefined })])).toBeNull(); // the cover-only match still needs one
  });

  it("returns nothing for a different book or a different author", () => {
    expect(detailsFrom("Dune", "Frank Herbert", [doc({ title: "Dune Messiah" })])).toBeNull();
    expect(detailsFrom("Dune", "Frank Herbert", [doc({ author_name: ["Brian Herbert"] })])).toBeNull();
    expect(detailsFrom("Dune", "Frank Herbert", [])).toBeNull();
  });

  it("drops page counts that are obvious artifacts", () => {
    expect(sanePageCount(1)).toBeUndefined(); // a real 1-page "edition" exists in the data
    expect(sanePageCount(25)).toBeUndefined();
    expect(sanePageCount(612)).toBe(612);
    expect(sanePageCount(9000)).toBeUndefined(); // a boxed set
    expect(sanePageCount(undefined)).toBeUndefined();
    expect(detailsFrom("Dune", "Frank Herbert", [doc({ number_of_pages_median: 1 })])?.pageCount).toBeUndefined();
  });
});

describe("looking a book up from the browser", () => {
  const respond = (docs: OlDoc[]) => (async () => ({ ok: true, json: async () => ({ docs }) }) as Response) as unknown as typeof fetch;

  it("returns what it finds", async () => {
    expect(await lookupDetails("Dune", "Frank Herbert", respond([doc({})]))).toMatchObject({ year: 1965, pageCount: 612 });
  });

  it("asks for English editions first, then more loosely", async () => {
    const asked: string[] = [];
    const fetcher = (async (url: string) => {
      asked.push(url);
      return { ok: true, json: async () => ({ docs: asked.length < 3 ? [] : [doc({})] }) } as Response;
    }) as unknown as typeof fetch;
    expect(await lookupDetails("Dune", "Frank Herbert", fetcher)).toMatchObject({ year: 1965 });
    expect(asked[0]).toContain("language=eng");
    expect(asked[1]).not.toContain("language=eng");
    expect(asked[2]).toContain("q=Dune+Herbert");
  });

  it("gives null, not an error, when nothing matches or Open Library can't be reached", async () => {
    expect(await lookupDetails("Dune", "Frank Herbert", respond([]))).toBeNull();
    const down = (async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    expect(await lookupDetails("Dune", "Frank Herbert", down)).toBeNull();
    const bad = (async () => ({ ok: false, json: async () => ({}) }) as Response) as unknown as typeof fetch;
    expect(await lookupDetails("Dune", "Frank Herbert", bad)).toBeNull();
  });
});
