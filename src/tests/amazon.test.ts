import { describe, expect, it, vi } from "vitest";
import { asinFromUrl, decodeEntities, firstLast, isAmazonHost, parseAmazonPage } from "../../supabase/functions/amazon-book/parse";
import {
  isbn10to13,
  isbn13to10,
  isValidIsbn10,
  isValidIsbn13,
  lookupByIsbn,
  parseAmazonInput,
  readAmazonLink,
  shortTitle,
  type AmazonFunctionResult,
} from "@/lib/amazon";
import { amazonUrl } from "@/domain/bookActions";

/** A page shaped like the parts of an Amazon book page that matter (taken from a real one). */
const PAGE = `
<html><head><title>The Great Gatsby: The Only Authorized Edition: Fitzgerald, F. Scott: 9780743273565: Amazon.com: Books</title></head><body>
<span id="productTitle" class="a-size-extra-large"> The Great Gatsby: The Only Authorized Edition </span>
<div id="bylineInfo"><span class="author notFaded" data-width="215"><a class="a-link-normal" href="/F-Scott-Fitzgerald/e/B000AQ0A8W">F. Scott Fitzgerald</a><span class="contribution">(Author)</span></span>
<span class="author notFaded"><a class="a-link-normal" href="/x">Someone Else</a><span class="contribution">(Foreword)</span></span></div>
<li id="rpi-attribute-book_details-fiona_pages" data-rpi-attribute-name="book_details-fiona_pages"><div class="rpi-attribute-label"><span>Print length</span></div>
<div class="rpi-attribute-value"><span>180 pages</span></div></li>
<img id="landingImage" data-old-hires="https://m.media-amazon.com/images/I/81T4dS6IkaL._SL1500_.jpg" src="https://m.media-amazon.com/images/I/small.jpg">
<ul><li><span class="a-text-bold">ISBN-10 &lrm; : </span><span>0743273567</span></li>
<li><span class="a-text-bold">ISBN-13 &lrm; : </span><span>978-0743273565</span></li></ul>
</body></html>`;

describe("reading an Amazon book page", () => {
  it("finds the title, first author, pages, cover and ISBNs", () => {
    expect(parseAmazonPage(PAGE)).toEqual({
      title: "The Great Gatsby: The Only Authorized Edition",
      author: "F. Scott Fitzgerald",
      pages: 180,
      coverUrl: "https://m.media-amazon.com/images/I/81T4dS6IkaL._SL1500_.jpg",
      isbn10: "0743273567",
      isbn13: "9780743273565",
    });
  });

  it("takes only the first author, not the forewords and illustrators after", () => {
    expect(parseAmazonPage(PAGE).author).toBe("F. Scott Fitzgerald");
  });

  it("falls back to the page's title tag when the product block is missing", () => {
    const html = "<html><head><title>Dune: Herbert, Frank: 9780441172719: Amazon.com: Books</title></head><body></body></html>";
    expect(parseAmazonPage(html)).toMatchObject({ title: "Dune", author: "Frank Herbert", isbn13: "9780441172719" });
  });

  it("decodes entities and tidies spacing in titles", () => {
    const html = `<span id="productTitle"> Dungeon&nbsp;Crawler Carl: A LitRPG &amp; Adventure (Dungeon Crawler Carl Book&#160;1) </span>`;
    expect(parseAmazonPage(html).title).toBe("Dungeon Crawler Carl: A LitRPG & Adventure (Dungeon Crawler Carl Book 1)");
    expect(decodeEntities("Ender&#39;s &#x41;")).toBe("Ender's A");
  });

  it("leaves out what it can't find instead of guessing", () => {
    expect(parseAmazonPage(`<span id="productTitle">Only A Title</span>`)).toEqual({ title: "Only A Title" });
    expect(parseAmazonPage("<html></html>")).toEqual({});
  });

  it("ignores a page count that can't be right, and a cover from a site that isn't Amazon's images", () => {
    const html = `<span id="productTitle">T</span><span id="rpi-attribute-book_details-fiona_pages"></span><span>3 pages</span>
      <img data-old-hires="https://evil.example.com/x.jpg">`;
    const out = parseAmazonPage(html);
    expect(out.pages).toBeUndefined();
    expect(out.coverUrl).toBeUndefined();
  });

  it("notices when Amazon asks for proof you're human instead of showing the book", () => {
    expect(parseAmazonPage("<html><body>Enter the characters you see below. Sorry, we just need to make sure you're not a robot.</body></html>")).toEqual({ blocked: true });
  });

  it("turns 'Last, First' into 'First Last'", () => {
    expect(firstLast("Fitzgerald, F. Scott")).toBe("F. Scott Fitzgerald");
    expect(firstLast("Plato")).toBe("Plato");
  });
});

describe("Amazon links and hosts", () => {
  it("finds the product id however the link is written", () => {
    expect(asinFromUrl("https://www.amazon.com/dp/0743273567")).toBe("0743273567");
    expect(asinFromUrl("https://www.amazon.com/The-Great-Gatsby/dp/0743273567/ref=sr_1_1?tag=x")).toBe("0743273567");
    expect(asinFromUrl("https://www.amazon.com/gp/product/B0CKM7B2F8?th=1")).toBe("B0CKM7B2F8");
    expect(asinFromUrl("https://www.amazon.com/s?k=dune")).toBeUndefined();
  });

  it("only ever accepts Amazon hosts", () => {
    for (const ok of ["www.amazon.com", "amazon.co.uk", "smile.amazon.com", "a.co", "amzn.to", "www.amazon.de"]) expect(isAmazonHost(ok), ok).toBe(true);
    for (const bad of ["example.com", "amazon.com.evil.com", "evilamazon.com", "notamazon.com", "a.co.evil.com", "amazon.com.", "localhost"]) {
      expect(isAmazonHost(bad), bad).toBe(false);
    }
  });
});

describe("ISBNs", () => {
  it("checks ISBN-10 and ISBN-13 check digits", () => {
    expect(isValidIsbn10("0743273567")).toBe(true);
    expect(isValidIsbn10("0743273568")).toBe(false);
    expect(isValidIsbn10("080442957X")).toBe(true);
    expect(isValidIsbn13("9780743273565")).toBe(true);
    expect(isValidIsbn13("9780743273566")).toBe(false);
    expect(isValidIsbn13("1234567890123")).toBe(false);
  });

  it("converts both ways (verified against real pairs)", () => {
    expect(isbn10to13("0743273567")).toBe("9780743273565");
    expect(isbn10to13("0812974611")).toBe("9780812974614");
    expect(isbn10to13("080442957X")).toBe("9780804429573");
    expect(isbn13to10("9780743273565")).toBe("0743273567");
    expect(isbn13to10("9780804429573")).toBe("080442957X");
    expect(isbn13to10("9791032305690")).toBeUndefined(); // 979 has no ISBN-10
    expect(isbn10to13("0743273568")).toBeUndefined();
  });
});

describe("what was pasted", () => {
  it("reads a product link, with or without the scheme, ignoring tracking", () => {
    expect(parseAmazonInput("https://www.amazon.com/dp/0743273567?tag=abc&ref_=x")).toMatchObject({ kind: "url", asin: "0743273567", isbn10: "0743273567" });
    expect(parseAmazonInput("amazon.com/The-Road/dp/0307387895/")).toMatchObject({ kind: "url", asin: "0307387895" });
    expect(parseAmazonInput("  https://www.amazon.com/gp/product/B0CKM7B2F8  ")).toMatchObject({ kind: "url", asin: "B0CKM7B2F8", isbn10: undefined });
  });

  it("reads a short share link", () => {
    expect(parseAmazonInput("https://a.co/d/0cU1u8Y5")).toMatchObject({ kind: "short" });
    expect(parseAmazonInput("amzn.to/3xyzabc")).toMatchObject({ kind: "short" });
  });

  it("reads an ISBN, hyphens and all, and a Kindle product id", () => {
    expect(parseAmazonInput("978-0-7432-7356-5")).toEqual({ kind: "isbn", isbn13: "9780743273565", isbn10: "0743273567" });
    expect(parseAmazonInput("0743273567")).toEqual({ kind: "isbn", isbn10: "0743273567", isbn13: "9780743273565" });
    expect(parseAmazonInput("B0CKM7B2F8")).toEqual({ kind: "asin", asin: "B0CKM7B2F8" });
  });

  it("refuses anything else: other sites, bad ISBNs, plain text", () => {
    for (const t of ["", "   ", "https://example.com/dp/0743273567", "0743273568", "just a title", "https://amazon.com.evil.com/dp/0743273567", "javascript:alert(1)"]) {
      expect(parseAmazonInput(t), t).toEqual({ kind: "none" });
    }
  });
});

describe("titles", () => {
  it("drops the subtitle and the series note, keeping a name you'd recognise", () => {
    expect(shortTitle("The Great Gatsby: The Only Authorized Edition")).toBe("The Great Gatsby");
    expect(shortTitle("Dungeon Crawler Carl: A LitRPG Adventure (Dungeon Crawler Carl Book 1)")).toBe("Dungeon Crawler Carl");
    expect(shortTitle("Pompeii: A Novel")).toBe("Pompeii");
    expect(shortTitle("Project Hail Mary")).toBe("Project Hail Mary");
    expect(shortTitle("Dune (Dune Chronicles, Book 1)")).toBe("Dune");
  });
});

const openLibrary = (rec: object | null, isbn = "9780743273565") =>
  vi.fn(async () => ({ ok: true, json: async () => (rec ? { [`ISBN:${isbn}`]: rec } : {}) }) as Response) as unknown as typeof fetch;

describe("Open Library by ISBN", () => {
  it("returns title, first author, pages and cover for that edition", async () => {
    const f = openLibrary({ title: "The Great Gatsby", authors: [{ name: "F. Scott Fitzgerald" }, { name: "Other" }], number_of_pages: 180, cover: { medium: "https://covers.openlibrary.org/b/id/1-M.jpg" } });
    expect(await lookupByIsbn("9780743273565", f)).toEqual({ title: "The Great Gatsby", author: "F. Scott Fitzgerald", pages: 180, coverUrl: "https://covers.openlibrary.org/b/id/1-M.jpg" });
  });

  it("gives nothing for an unknown ISBN, an error, or a silly page count", async () => {
    expect(await lookupByIsbn("9780743273565", openLibrary(null))).toBeNull();
    expect(await lookupByIsbn("9780743273565", (async () => ({ ok: false }) as Response) as unknown as typeof fetch)).toBeNull();
    expect(await lookupByIsbn("9780743273565", (async () => { throw new Error("offline"); }) as unknown as typeof fetch)).toBeNull();
    expect((await lookupByIsbn("9780743273565", openLibrary({ title: "T", number_of_pages: 1 })))?.pages).toBeUndefined();
  });
});

const GATSBY: AmazonFunctionResult = {
  asin: "0743273567",
  title: "The Great Gatsby: The Only Authorized Edition",
  author: "F. Scott Fitzgerald",
  pages: 180,
  coverUrl: "https://m.media-amazon.com/images/I/81T4dS6IkaL._SL1500_.jpg",
  isbn13: "9780743273565",
};
const noNetwork = (async () => ({ ok: true, json: async () => ({ docs: [] }) }) as Response) as unknown as typeof fetch;

describe("adding from an Amazon link", () => {
  it("uses everything Amazon's page gave, with the short title and the full one to choose from", async () => {
    const r = await readAmazonLink("https://www.amazon.com/dp/0743273567", { ask: async () => GATSBY, fetcher: openLibrary({ title: "x" }) });
    expect(r).toEqual({
      ok: true,
      book: {
        title: "The Great Gatsby",
        fullTitle: "The Great Gatsby: The Only Authorized Edition",
        author: "F. Scott Fitzgerald",
        pages: 180,
        coverUrl: GATSBY.coverUrl,
        asin: "0743273567",
        from: { amazon: true, openLibrary: true },
      },
    });
  });

  it("follows a short share link through the helper", async () => {
    const ask = vi.fn(async () => ({ ...GATSBY, asin: "0812974611", title: "Pompeii: A Novel", author: "Robert Harris", pages: 304, isbn13: "9780812974614" }));
    const r = await readAmazonLink("https://a.co/d/0cU1u8Y5", { ask, fetcher: noNetwork });
    expect(ask).toHaveBeenCalledWith("https://a.co/d/0cU1u8Y5");
    expect(r).toMatchObject({ ok: true, book: { title: "Pompeii", author: "Robert Harris", pages: 304, asin: "0812974611" } });
  });

  it("explains that a short link needs the shared library when there's no helper, and when it can't read it", async () => {
    expect(await readAmazonLink("https://a.co/d/0cU1u8Y5", { fetcher: noNetwork })).toEqual({ ok: false, reason: "short-needs-signin" });
    expect(await readAmazonLink("https://a.co/d/0cU1u8Y5", { ask: async () => null, fetcher: noNetwork })).toEqual({ ok: false, reason: "unreadable" });
    expect(await readAmazonLink("https://a.co/d/0cU1u8Y5", { ask: async () => ({ blocked: true }), fetcher: noNetwork })).toEqual({ ok: false, reason: "unreadable" });
  });

  it("falls back to Open Library by ISBN when Amazon's page can't be read", async () => {
    const f = openLibrary({ title: "The Great Gatsby", authors: [{ name: "F. Scott Fitzgerald" }], number_of_pages: 180, cover: { medium: "https://covers.openlibrary.org/b/id/1-M.jpg" } }, "0743273567");
    for (const ask of [undefined, async () => ({ blocked: true, asin: "0743273567" }) as AmazonFunctionResult, async () => { throw new Error("down"); }]) {
      const r = await readAmazonLink("https://www.amazon.com/dp/0743273567", { ask, fetcher: f });
      expect(r).toMatchObject({ ok: true, book: { title: "The Great Gatsby", author: "F. Scott Fitzgerald", pages: 180, asin: "0743273567", from: { amazon: false, openLibrary: true } } });
    }
  });

  it("takes a bare ISBN, with no helper at all", async () => {
    const f = openLibrary({ title: "The Great Gatsby", authors: [{ name: "F. Scott Fitzgerald" }], number_of_pages: 180 });
    const r = await readAmazonLink("978-0-7432-7356-5", { fetcher: f });
    expect(r).toMatchObject({ ok: true, book: { title: "The Great Gatsby", pages: 180, asin: "0743273567" } });
  });

  it("fills a missing cover or page count by a strict title + author search, never a guess", async () => {
    const search = vi.fn(async () => ({
      ok: true,
      json: async () => ({ docs: [{ title: "The Great Gatsby", author_name: ["F. Scott Fitzgerald"], cover_i: 9, edition_count: 1000, number_of_pages_median: 200 }] }),
    }) as Response) as unknown as typeof fetch;
    const noCover: AmazonFunctionResult = { ...GATSBY, coverUrl: undefined, pages: undefined };
    const r = await readAmazonLink("https://www.amazon.com/dp/0743273567", { ask: async () => noCover, fetcher: search });
    expect(r).toMatchObject({ ok: true, book: { coverUrl: "https://covers.openlibrary.org/b/id/9-M.jpg", pages: 200 } });
  });

  it("says it couldn't find the book when nothing identifies it", async () => {
    expect(await readAmazonLink("B0CKM7B2F8", { ask: async () => ({ asin: "B0CKM7B2F8", blocked: true }), fetcher: noNetwork })).toEqual({ ok: false, reason: "not-found" });
    expect(await readAmazonLink("0743273567", { fetcher: openLibrary(null) })).toEqual({ ok: false, reason: "not-found" });
  });

  it("refuses text that isn't an Amazon link or ISBN", async () => {
    expect(await readAmazonLink("The Great Gatsby", { fetcher: noNetwork })).toEqual({ ok: false, reason: "unreadable" });
    expect(await readAmazonLink("https://example.com/dp/0743273567", { fetcher: noNetwork })).toEqual({ ok: false, reason: "unreadable" });
  });

  it("keeps a title that has no subtitle as it is, with no 'full title' to choose", async () => {
    const r = await readAmazonLink("https://www.amazon.com/dp/B0CKM7B2F8", { ask: async () => ({ asin: "B0CKM7B2F8", title: "Project Hail Mary", author: "Andy Weir", pages: 496 }), fetcher: noNetwork });
    expect(r).toMatchObject({ ok: true, book: { title: "Project Hail Mary", fullTitle: undefined, asin: "B0CKM7B2F8" } });
  });
});

describe("the Amazon button on a book", () => {
  it("goes straight to the book when its id is known, otherwise to a plain search", () => {
    expect(amazonUrl({ title: "Dune", author: "Frank Herbert", asin: "0441172717" })).toBe("https://www.amazon.com/dp/0441172717");
    expect(amazonUrl({ title: "Dune", author: "Frank Herbert" })).toBe("https://www.amazon.com/s?k=Dune+Frank+Herbert");
    expect(amazonUrl({ title: "Dune", asin: "../x" })).not.toContain("../x");
  });
});
