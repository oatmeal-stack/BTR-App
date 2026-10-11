import { describe, expect, it } from "vitest";
import { authorKey, coverUrl, parseCovers, pickMatch, type OlDoc } from "../../scripts/lib/covers";
import { toCoversSql } from "../../scripts/lib/seed";
import { largeCoverUrl } from "../lib/coverUrl";
import { SAMPLE_BOOKS as sampleBooks } from "../data/sampleBooks";

const doc = (title: string, authors: string[], cover_i: number | undefined, edition_count = 1): OlDoc => ({
  title,
  author_name: authors,
  cover_i,
  edition_count,
});

describe("picking the right Open Library match", () => {
  it("takes the book whose title and author last name both match", () => {
    const m = pickMatch("Dune", "Frank Herbert", [
      doc("Dune Messiah", ["Frank Herbert"], 2),
      doc("Dune", ["Frank Herbert"], 1, 400),
    ]);
    expect(m?.cover_i).toBe(1);
  });

  it("ignores the leading article on either side", () => {
    expect(pickMatch("The Road", "Cormac McCarthy", [doc("Road", ["Cormac McCarthy"], 5)])?.cover_i).toBe(5);
    expect(pickMatch("Road", "Cormac McCarthy", [doc("The Road", ["Cormac McCarthy"], 6)])?.cover_i).toBe(6);
  });

  it("accepts a subtitle on one side", () => {
    const m = pickMatch("Barbarian Days", "William Finnegan", [
      doc("Barbarian Days: A Surfing Life", ["William Finnegan"], 9),
    ]);
    expect(m?.cover_i).toBe(9);
  });

  it("never takes a book by a different author, even with the same title", () => {
    expect(pickMatch("Dune", "Frank Herbert", [doc("Dune", ["Brian Herbert"], 3)])).toBeNull();
    expect(pickMatch("Dune", "Frank Herbert", [doc("Dune", ["Someone Else"], 3)])).toBeNull();
  });

  it("never takes a different book by the right author", () => {
    expect(pickMatch("Dune", "Frank Herbert", [doc("Children of Dune", ["Frank Herbert"], 4)])).toBeNull();
  });

  it("skips results with no cover and gives up on a book with no author to check", () => {
    expect(pickMatch("Dune", "Frank Herbert", [doc("Dune", ["Frank Herbert"], undefined)])).toBeNull();
    expect(pickMatch("Dune", undefined, [doc("Dune", ["Frank Herbert"], 1)])).toBeNull();
  });

  it("trusts an exact title when the author is listed in another script, but not a loose one", () => {
    expect(pickMatch("1Q84", "Haruki Murakami", [doc("1Q84", ["村上春樹"], 11)])?.cover_i).toBe(11);
    expect(pickMatch("1Q84", "Haruki Murakami", [doc("1Q84 [3/3]", ["村上春樹"], 12)])).toBeNull();
    expect(pickMatch("Hunger", "Knut Hamsun", [doc("Hunger", ["Роберт Мур"], 13)])?.cover_i).toBe(13);
  });

  it("matches a last-name-only author, and accents", () => {
    expect(authorKey("Cormac McCarthy")).toBe("mccarthy");
    expect(authorKey("Wayne")).toBe("wayne");
    expect(pickMatch("Pedro Páramo", "Rulfo", [doc("Pedro Paramo", ["Juan Rulfo"], 8)])?.cover_i).toBe(8);
  });
});

describe("cover urls", () => {
  it("makes the small jacket url, and the large one for the book page", () => {
    expect(coverUrl(123)).toBe("https://covers.openlibrary.org/b/id/123-M.jpg");
    expect(largeCoverUrl(coverUrl(123))).toBe("https://covers.openlibrary.org/b/id/123-L.jpg");
    expect(largeCoverUrl("https://example.com/x.jpg")).toBe("https://example.com/x.jpg");
  });

  it("reads covers.psv, ignoring comments and bad lines", () => {
    expect(parseCovers("# note\nbk-a|12\nbk-b|nope\n\nbk-c|7\n")).toEqual([
      { id: "bk-a", coverId: 12 },
      { id: "bk-c", coverId: 7 },
    ]);
  });
});

describe("the SQL that fills covers on a live library", () => {
  it("only touches books with no cover, and only the ones we found a cover for", () => {
    const [a, b] = sampleBooks;
    const sql = toCoversSql([{ ...a, coverUrl: coverUrl(1) }, b]);
    expect(sql).toContain(`'${a.id}'`);
    expect(sql).not.toContain(`'${b.id}'`);
    expect(sql).toMatch(/cover_url is null/);
  });
});
