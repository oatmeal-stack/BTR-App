import { describe, expect, it } from "vitest";
import type { Book } from "@/domain/book";
import { SAMPLE_BOOKS } from "@/data/sampleBooks";
import * as a from "@/domain/bookActions";
import { LocalBookRepository } from "@/repositories/LocalBookRepository";
import { memoryStorage } from "./helpers";

const NOW = "2026-10-12T12:00:00.000Z";
const dune = SAMPLE_BOOKS.find((b) => b.title === "Dune")!;
const road = SAMPLE_BOOKS.find((b) => b.title === "The Road")!;

describe("editing a book", () => {
  it("starts the form from the book as it is", () => {
    const e = a.editFromBook(road);
    expect(e).toMatchObject({ title: road.title, author: road.author, genres: road.genres, moods: road.moods });
    expect(e.sources).toEqual(road.sources.map((s) => s.source));
  });

  it("saves every field, trims, and a blank value clears the field", () => {
    const edit = {
      ...a.editFromBook(dune),
      title: "  Dune (Deluxe)  ",
      author: "",
      year: 1965,
      pageCount: 612,
      coverUrl: " https://example.com/c.jpg ",
      sourceNote: "",
    };
    const saved = a.updateBook(SAMPLE_BOOKS, dune.id, edit, NOW).find((b) => b.id === dune.id)!;
    expect(saved).toMatchObject({ title: "Dune (Deluxe)", year: 1965, pageCount: 612, coverUrl: "https://example.com/c.jpg", updatedAt: NOW });
    expect(saved.author).toBeUndefined();
    expect(saved.sourceNote).toBeUndefined();
    expect(saved.id).toBe(dune.id); // the id never changes, so links and removals keep working
  });

  it("only touches the book being edited, and never drops a book", () => {
    const after = a.updateBook(SAMPLE_BOOKS, dune.id, { ...a.editFromBook(dune), title: "Changed" }, NOW);
    expect(after).toHaveLength(SAMPLE_BOOKS.length);
    expect(after.filter((b) => b.id !== dune.id)).toEqual(SAMPLE_BOOKS.filter((b) => b.id !== dune.id));
  });

  it("ignores a nonsense year or page count, and rounds sensibly", () => {
    const saved = a
      .updateBook(SAMPLE_BOOKS, dune.id, { ...a.editFromBook(dune), year: -5, pageCount: Number.NaN }, NOW)
      .find((b) => b.id === dune.id)!;
    expect(saved.year).toBeUndefined();
    expect(saved.pageCount).toBeUndefined();
  });

  it("keeps the rank of a list the book stays on, adds new lists, and never leaves a book on no list", () => {
    const ranked = road.sources.find((s) => s.rank !== undefined);
    const edit = { ...a.editFromBook(road), sources: [...road.sources.map((s) => s.source), "My wife's picks"] };
    const saved = a.updateBook(SAMPLE_BOOKS, road.id, edit, NOW).find((b) => b.id === road.id)!;
    expect(saved.sources.find((s) => s.source === ranked?.source)?.rank).toBe(ranked?.rank);
    expect(saved.sources.at(-1)).toEqual({ source: "My wife's picks" });

    const none = a.updateBook(SAMPLE_BOOKS, road.id, { ...a.editFromBook(road), sources: [] }, NOW).find((b) => b.id === road.id)!;
    expect(none.sources).toEqual([{ source: "My additions" }]);
  });
});

describe("a correction that makes a duplicate", () => {
  it("finds the other copy, whatever the spelling", () => {
    expect(a.findDuplicate(SAMPLE_BOOKS, road.id, { title: "Dune", author: "Herbert" })?.id).toBe(dune.id);
    expect(a.findDuplicate(SAMPLE_BOOKS, road.id, { title: "the dune!", author: "Frank Herbert" })?.id).toBe(dune.id);
  });

  it("doesn't call a book its own duplicate, or flag a different book", () => {
    expect(a.findDuplicate(SAMPLE_BOOKS, dune.id, { title: "Dune", author: "Frank Herbert" })).toBeUndefined();
    expect(a.findDuplicate(SAMPLE_BOOKS, road.id, { title: "Dune Messiah", author: "Frank Herbert" })).toBeUndefined();
    expect(a.findDuplicate(SAMPLE_BOOKS, road.id, { title: "", author: "" })).toBeUndefined();
  });

  it("ignores a removed copy: that one is out of the picture", () => {
    const books = a.removeBook(SAMPLE_BOOKS, dune.id, NOW);
    expect(a.findDuplicate(books, road.id, { title: "Dune", author: "Herbert" })).toBeUndefined();
  });
});

describe("merging two copies of a book", () => {
  const keep: Book = {
    ...dune,
    id: "keep",
    year: undefined,
    pageCount: undefined,
    coverUrl: undefined,
    genres: ["Sci-fi"],
    moods: [],
    sources: [{ source: "Fantasy Top 100 UK", rank: 3 }],
    sourceNote: "Kept note",
    status: "want_to_read",
    favorite: false,
  };
  const drop: Book = {
    ...dune,
    id: "drop",
    year: 1965,
    pageCount: 612,
    coverUrl: "https://example.com/d.jpg",
    genres: ["Sci-fi", "Epic"],
    moods: ["Epic"],
    sources: [{ source: "Fantasy Top 100 UK", rank: 99 }, { source: "My additions" }],
    sourceNote: "Dropped note",
    status: "reading",
    favorite: true,
  };
  const books = [keep, drop, road];

  it("moves lists, tags, favorites, progress and anything missing onto the kept book", () => {
    const merged = a.mergeBooks(books, "keep", "drop", NOW).find((b) => b.id === "keep")!;
    expect(merged).toMatchObject({ year: 1965, pageCount: 612, coverUrl: "https://example.com/d.jpg", favorite: true, status: "reading", title: keep.title });
    expect(merged.genres).toEqual(["Sci-fi", "Epic"]);
    expect(merged.moods).toEqual(["Epic"]);
    expect(merged.sources).toEqual([{ source: "Fantasy Top 100 UK", rank: 3 }, { source: "My additions" }]); // the kept rank wins
    expect(merged.sourceNote).toBe("Kept note. Dropped note");
  });

  it("removes the other copy rather than deleting it, and leaves everything else alone", () => {
    const after = a.mergeBooks(books, "keep", "drop", NOW);
    expect(after).toHaveLength(3);
    expect(after.find((b) => b.id === "drop")?.removedAt).toBe(NOW);
    expect(after.find((b) => b.id === road.id)).toEqual(road);
  });

  it("keeps the kept book's own values when both have them, and never downgrades its status", () => {
    const strong = { ...keep, year: 1970, status: "read" as const };
    const merged = a.mergeBooks([strong, drop], "keep", "drop", NOW).find((b) => b.id === "keep")!;
    expect(merged.year).toBe(1970);
    expect(merged.status).toBe("read");
  });

  it("re-points notes to the kept book", () => {
    const notes = [
      { id: "n1", bookId: "drop", body: "x", createdAt: NOW, updatedAt: NOW },
      { id: "n2", bookId: "keep", body: "y", createdAt: NOW, updatedAt: NOW },
      { id: "n3", bookId: "other", body: "z", createdAt: NOW, updatedAt: NOW },
    ];
    expect(a.mergeNotes(notes, "keep", "drop").map((n) => n.bookId)).toEqual(["keep", "keep", "other"]);
  });

  it("does nothing for a missing book or a book merged into itself", () => {
    expect(a.mergeBooks(books, "keep", "nope", NOW)).toBe(books);
    expect(a.mergeBooks(books, "keep", "keep", NOW)).toBe(books);
  });
});

describe("the facts line on a book page", () => {
  it("shows year and pages, or whichever is known, or nothing", () => {
    expect(a.bookFacts({ year: 1965, pageCount: 612 })).toBe("Published 1965 · 612 pages");
    expect(a.bookFacts({ year: 1965 })).toBe("Published 1965");
    expect(a.bookFacts({ pageCount: 1250 })).toBe("1,250 pages");
    expect(a.bookFacts({})).toBe("");
  });
});

describe("edits on this device", () => {
  it("survive a reload", async () => {
    const storage = memoryStorage();
    const repo = new LocalBookRepository(storage, SAMPLE_BOOKS);
    await repo.updateBook(dune.id, { ...a.editFromBook(dune), pageCount: 612, year: 1965 });
    const book = (await new LocalBookRepository(storage, SAMPLE_BOOKS).listBooks()).find((b) => b.id === dune.id)!;
    expect(book).toMatchObject({ pageCount: 612, year: 1965 });
  });

  it("merge moves the notes and survives a reload", async () => {
    const storage = memoryStorage();
    const repo = new LocalBookRepository(storage, SAMPLE_BOOKS);
    await repo.addNote(road.id, "Borrowed copy");
    await repo.mergeBooks({ id: dune.id }, { id: road.id, title: road.title, author: road.author });
    const again = new LocalBookRepository(storage, SAMPLE_BOOKS);
    expect((await again.listNotes()).find((n) => n.body === "Borrowed copy")?.bookId).toBe(dune.id);
    expect((await again.listBooks()).find((b) => b.id === road.id)?.removedAt).toBeTruthy();
  });
});
