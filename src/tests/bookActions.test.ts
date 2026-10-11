import { describe, expect, it } from "vitest";
import { MY_ADDITIONS, type Book } from "@/domain/book";
import {
  addBookToLibrary,
  addNote,
  amazonSearchUrl,
  deleteNote,
  facetCounts,
  filterBooks,
  isSameBook,
  listCounts,
  pickForYou,
  pickRandom,
  setFavorite,
  setStatus,
  sortBooks,
  updateNote,
} from "@/domain/bookActions";
import { SAMPLE_BOOKS } from "@/data/sampleBooks";

const NOW = "2026-10-11T12:00:00.000Z";
const LATER = "2026-10-12T12:00:00.000Z";

describe("saving books", () => {
  it("adds exactly one entry, even after repeated taps", () => {
    let books: Book[] = [];
    for (let i = 0; i < 3; i++) {
      books = addBookToLibrary(books, { title: "Shogun", author: "James Clavell" }, NOW, `id-${i}`).books;
    }
    expect(books).toHaveLength(1);
    expect(books[0].id).toBe("id-0");
  });

  it("gives hand-added books the 'My additions' source and Want to read status", () => {
    const { book, created } = addBookToLibrary([], { title: "Space", author: "James Michener" }, NOW, "x");
    expect(created).toBe(true);
    expect(book.status).toBe("want_to_read");
    expect(book.sources).toEqual([{ source: MY_ADDITIONS }]);
  });

  it("recognises the same book across lists even when Man Book Club uses last names only", () => {
    expect(isSameBook({ title: "Lonesome Dove", author: "McMurtry" }, { title: "The Lonesome Dove", author: "Larry McMurtry" })).toBe(true);
    expect(isSameBook({ title: "The Outsider", author: "Camus" }, { title: "The Outsiders", author: "Hinton" })).toBe(false);
    expect(isSameBook({ title: "Dune", author: "Frank Herbert" }, { title: "Dune", author: "Someone Else" })).toBe(false);
  });

  it("folds a cross-source book into one entry with both sources", () => {
    const seed = SAMPLE_BOOKS.find((b) => b.title.startsWith("The Long Way"))!;
    const result = addBookToLibrary(
      [seed],
      { title: "The Long Way to a Small, Angry Planet", author: "Becky Chambers", sources: [{ source: "Brand New List" }] },
      NOW,
      "never-used",
    );
    expect(result.created).toBe(false);
    expect(result.books).toHaveLength(1);
    expect(result.book.sources.map((s) => s.source)).toEqual([
      "Tough Guy Book Club",
      "Fantasy Top 100 UK",
      "Brand New List",
    ]);
  });

  it("keeps a note typed at quick add when the book already exists", () => {
    const first = addBookToLibrary([], { title: "Dune", author: "Frank Herbert" }, NOW, "a");
    const again = addBookToLibrary(first.books, { title: "dune", note: "Ken recommended it" }, LATER, "b");
    expect(again.books).toHaveLength(1);
    expect(again.book.sourceNote).toBe("Ken recommended it");
  });

  it("sample catalog has no duplicate books and the cross-source example appears once", () => {
    for (const b of SAMPLE_BOOKS) {
      expect(SAMPLE_BOOKS.filter((o) => isSameBook(o, b))).toHaveLength(1);
    }
    const long = SAMPLE_BOOKS.filter((b) => b.title.startsWith("The Long Way"));
    expect(long).toHaveLength(1);
    expect(long[0].sources.map((s) => s.source)).toEqual(["Tough Guy Book Club", "Fantasy Top 100 UK"]);
  });
});

describe("status, favorites and notes", () => {
  const book = SAMPLE_BOOKS[0];

  it("changing status changes the entry but never the book id", () => {
    const next = setStatus(SAMPLE_BOOKS, book.id, "read", LATER);
    const changed = next.find((b) => b.id === book.id)!;
    expect(changed.status).toBe("read");
    expect(changed.id).toBe(book.id);
    expect(changed.updatedAt).toBe(LATER);
    expect(next.filter((b) => b.id !== book.id)).toEqual(SAMPLE_BOOKS.filter((b) => b.id !== book.id));
  });

  it("toggles favorites", () => {
    const on = setFavorite(SAMPLE_BOOKS, book.id, true, NOW);
    expect(on.find((b) => b.id === book.id)!.favorite).toBe(true);
    const off = setFavorite(on, book.id, false, NOW);
    expect(off.find((b) => b.id === book.id)!.favorite).toBe(false);
  });

  it("allows many notes per book and ignores empty ones", () => {
    let notes = addNote([], book.id, "  First  ", NOW, "n1");
    notes = addNote(notes, book.id, "Second", NOW, "n2");
    notes = addNote(notes, book.id, "   ", NOW, "n3");
    expect(notes.map((n) => n.body)).toEqual(["First", "Second"]);
  });

  it("edits and deletes notes", () => {
    let notes = addNote([], book.id, "Original", NOW, "n1");
    notes = updateNote(notes, "n1", "Edited", LATER);
    expect(notes[0]).toMatchObject({ body: "Edited", createdAt: NOW, updatedAt: LATER });
    expect(updateNote(notes, "n1", "   ", LATER)).toEqual(notes);
    expect(deleteNote(notes, "n1")).toEqual([]);
  });
});

describe("finding books", () => {
  it("filters by source and returns exactly the books tagged with it", () => {
    const man = filterBooks(SAMPLE_BOOKS, { source: "Man Book Club" });
    expect(man.length).toBeGreaterThan(0);
    expect(man.every((b) => b.sources.some((s) => s.source === "Man Book Club"))).toBe(true);
    expect(man).toHaveLength(SAMPLE_BOOKS.filter((b) => b.sources.some((s) => s.source === "Man Book Club")).length);
  });

  it("a cross-source book shows up under each of its lists", () => {
    const title = "The Long Way to a Small, Angry Planet";
    for (const source of ["Tough Guy Book Club", "Fantasy Top 100 UK"]) {
      expect(filterBooks(SAMPLE_BOOKS, { source }).map((b) => b.title)).toContain(title);
    }
  });

  it("searches title and author, ignoring case, accents and word order", () => {
    expect(filterBooks(SAMPLE_BOOKS, { query: "le carre tinker" }).map((b) => b.title)).toEqual(["Tinker Tailor Soldier Spy"]);
    expect(filterBooks(SAMPLE_BOOKS, { query: "HERRON" }).map((b) => b.title)).toEqual(["Slow Horses"]);
    expect(filterBooks(SAMPLE_BOOKS, { query: "zzzz" })).toEqual([]);
  });

  it("combines filters", () => {
    const r = filterBooks(SAMPLE_BOOKS, { genre: "Spy", mood: "Tense", source: "NYT Spy Novels" });
    expect(r.length).toBeGreaterThan(0);
    expect(r.every((b) => b.genres.includes("Spy") && b.moods.includes("Tense"))).toBe(true);
  });

  it("filters favorites and status", () => {
    const favs = filterBooks(SAMPLE_BOOKS, { favoritesOnly: true });
    expect(favs.every((b) => b.favorite)).toBe(true);
    expect(filterBooks(SAMPLE_BOOKS, { status: "reading" }).map((b) => b.title)).toEqual(["Demon Copperhead"]);
  });

  it("sorts by recent, title (ignoring The) and author last name", () => {
    expect(sortBooks(SAMPLE_BOOKS, "recent")[0].id).toBe(SAMPLE_BOOKS[0].id);
    const titles = sortBooks(SAMPLE_BOOKS, "title").map((b) => b.title);
    expect(titles.indexOf("The Pearl")).toBeGreaterThan(titles.indexOf("The Name of the Wind"));
    const authors = sortBooks(SAMPLE_BOOKS, "author").map((b) => b.author!);
    expect(authors[0]).toBe("Max Brooks");
  });

  it("counts lists and facets", () => {
    const lists = listCounts(SAMPLE_BOOKS);
    expect(lists.map((l) => l.source)).toEqual([
      "Man Book Club",
      "Tough Guy Book Club",
      "Fantasy Top 100 UK",
      "NYT Spy Novels",
      "NYT 50 Thrillers",
    ]);
    const genres = facetCounts(SAMPLE_BOOKS, "genres");
    expect(genres[0].count).toBeGreaterThanOrEqual(genres[genres.length - 1].count);
  });
});

describe("random picks", () => {
  it("never repeats the excluded book when others exist", () => {
    for (let i = 0; i < 50; i++) {
      expect(pickRandom(SAMPLE_BOOKS, SAMPLE_BOOKS[0].id)?.id).not.toBe(SAMPLE_BOOKS[0].id);
    }
  });

  it("is deterministic with a seeded generator and varies across values", () => {
    expect(pickRandom(SAMPLE_BOOKS, null, () => 0)?.id).toBe(SAMPLE_BOOKS[0].id);
    expect(pickRandom(SAMPLE_BOOKS, null, () => 0.999)?.id).toBe(SAMPLE_BOOKS[SAMPLE_BOOKS.length - 1].id);
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) seen.add(pickRandom(SAMPLE_BOOKS)!.id);
    expect(seen.size).toBeGreaterThan(10);
  });

  it("handles an empty library and a single book", () => {
    expect(pickRandom([])).toBeUndefined();
    expect(pickRandom([SAMPLE_BOOKS[0]], SAMPLE_BOOKS[0].id)?.id).toBe(SAMPLE_BOOKS[0].id);
  });

  it("'For you' only offers Want to read books, without the current pick", () => {
    const pick = SAMPLE_BOOKS[1].id;
    const picks = pickForYou(SAMPLE_BOOKS, 4, pick);
    expect(picks).toHaveLength(4);
    expect(picks.every((b) => b.status === "want_to_read" && b.id !== pick)).toBe(true);
    expect(new Set(picks.map((b) => b.id)).size).toBe(4);
  });
});

describe("Amazon link", () => {
  it("is a plain search link with no affiliate tag", () => {
    const url = amazonSearchUrl({ title: "The Right Stuff", author: "Tom Wolfe" });
    expect(url).toBe("https://www.amazon.com/s?k=The+Right+Stuff+Tom+Wolfe");
    expect(url).not.toMatch(/tag=/);
  });
});
