import { describe, expect, it } from "vitest";
import type { Book, BookNote } from "@/domain/book";
import { addNote, updateNote } from "@/domain/bookActions";
import * as R from "@/domain/readingActions";
import { LocalBookRepository } from "@/repositories/LocalBookRepository";
import { memoryStorage } from "./helpers";

const NOW = "2026-10-15T12:00:00.000Z";
const book = (id: string, over: Partial<Book> = {}): Book => ({
  id,
  title: id.toUpperCase(),
  status: "want_to_read",
  favorite: false,
  genres: [],
  moods: [],
  sources: [],
  createdAt: NOW,
  updatedAt: NOW,
  ...over,
});

describe("days", () => {
  it("uses the phone's own calendar day, zero-padded", () => {
    expect(R.todayLocal(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
    expect(R.todayLocal(new Date(2026, 11, 31, 0, 1))).toBe("2026-12-31");
  });

  it("writes a day as a date without shifting it by a time zone", () => {
    expect(R.dayLabel("2026-10-15")).toBe("Oct 15, 2026");
    expect(R.dayLabel("2026-01-01")).toBe("Jan 1, 2026");
    expect(R.dayLabel("whenever")).toBe("whenever");
  });
});

describe("reading now", () => {
  const books = [
    book("hobbit", { title: "The Hobbit", status: "reading" }),
    book("gates", { title: "The Gates of Midnight", status: "reading", startedOn: "2026-10-12" }),
    book("alchemist", { title: "The Alchemist", status: "reading", startedOn: "2026-10-01" }),
    book("genesis", { title: "Genesis", status: "reading" }),
    book("dune", { title: "Dune" }),
    book("gone", { title: "Gone", status: "reading", removedAt: NOW }),
  ];

  it("holds several books at once, started ones first (longest ago first), then the rest A to Z", () => {
    expect(R.readingNow(books).map((b) => b.id)).toEqual(["alchemist", "gates", "genesis", "hobbit"]);
  });

  it("never includes a removed book or one that isn't being read", () => {
    const ids = R.readingNow(books).map((b) => b.id);
    expect(ids).not.toContain("gone");
    expect(ids).not.toContain("dune");
  });
});

describe("Start and Finish", () => {
  const set = [book("a", { status: "reading" }), book("b", { status: "reading" })];

  it("Start records the day for that book only", () => {
    const out = R.startReading(set, "a", "2026-10-15", NOW);
    expect(out[0]).toMatchObject({ status: "reading", startedOn: "2026-10-15" });
    expect(out[1].startedOn).toBeUndefined();
  });

  it("Finish records the day and rating, keeps the start day, and leaves the others alone", () => {
    const started = R.startReading(set, "a", "2026-10-01", NOW);
    const out = R.finishReading(started, "a", { on: "2026-10-15", rating: 5 }, NOW);
    expect(out[0]).toMatchObject({ status: "read", startedOn: "2026-10-01", finishedOn: "2026-10-15", myRating: 5 });
    expect(out[1]).toEqual(started[1]);
  });

  it("ignores a rating outside 1 to 5 instead of saving it", () => {
    expect(R.finishReading(set, "a", { on: "2026-10-15", rating: 7 }, NOW)[0].myRating).toBeUndefined();
    expect(R.finishReading(set, "a", { on: "2026-10-15" }, NOW)[0].myRating).toBeUndefined();
  });

  it("keeps one take per book, trimmed, and a blank one removes it", () => {
    let takes = R.setTake([], "a", "  Loved it  ", NOW);
    expect(takes).toEqual([{ bookId: "a", body: "Loved it", updatedAt: NOW }]);
    takes = R.setTake(takes, "a", "Changed my mind", NOW);
    expect(takes.map((t) => t.body)).toEqual(["Changed my mind"]);
    expect(R.takeFor(takes, "a")?.body).toBe("Changed my mind");
    expect(R.setTake(takes, "a", "   ", NOW)).toEqual([]);
  });

  it("lists finished books newest first, undated ones after, A to Z", () => {
    const done = [
      book("x", { status: "read", finishedOn: "2026-01-01" }),
      book("y", { status: "read", finishedOn: "2026-09-01" }),
      book("z", { status: "read", title: "Zed" }),
      book("w", { status: "read", title: "Able" }),
      book("gone", { status: "read", removedAt: NOW }),
      book("v"),
    ];
    expect(R.finishedBooks(done).map((b) => b.id)).toEqual(["y", "x", "w", "z"]);
  });
});

describe("the Next books queue", () => {
  const books = [book("a"), book("b"), book("c"), book("d", { status: "reading" }), book("e", { status: "read" }), book("f", { removedAt: NOW })];

  it("adds to the end, once", () => {
    let q = R.addToNext([], "a");
    q = R.addToNext(q, "b");
    q = R.addToNext(q, "a");
    expect(q).toEqual([
      { bookId: "a", position: 0 },
      { bookId: "b", position: 1 },
    ]);
    expect(R.isQueued(q, "b")).toBe(true);
    expect(R.isQueued(q, "c")).toBe(false);
  });

  it("only unread, visible books can wait in it", () => {
    expect(books.filter(R.canQueue).map((b) => b.id)).toEqual(["a", "b", "c"]);
  });

  it("shows the queue in rank order and drops anything that can't be queued any more", () => {
    const q = [
      { bookId: "c", position: 0 },
      { bookId: "d", position: 1 },
      { bookId: "f", position: 2 },
      { bookId: "a", position: 3 },
      { bookId: "ghost", position: 4 },
    ];
    expect(R.nextQueue(books, q).map((b) => b.id)).toEqual(["c", "a"]);
  });

  it("re-ranks: named books first in the order given, the rest keep their order after", () => {
    const q = R.addToNext(R.addToNext(R.addToNext([], "a"), "b"), "c");
    expect(R.reorderNext(q, ["c", "a"]).map((n) => n.bookId)).toEqual(["c", "a", "b"]);
    expect(R.reorderNext(q, ["c", "c", "nope"]).map((n) => n.bookId)).toEqual(["c", "a", "b"]);
    expect(R.reorderNext(q, ["b"]).map((n) => n.position)).toEqual([0, 1, 2]);
  });

  it("removes a book and closes the gap", () => {
    const q = R.addToNext(R.addToNext(R.addToNext([], "a"), "b"), "c");
    expect(R.removeFromNext(q, "b")).toEqual([
      { bookId: "a", position: 0 },
      { bookId: "c", position: 1 },
    ]);
  });

  it("moves one place up or down, and stays put at the ends", () => {
    expect(R.moveInOrder(["a", "b", "c"], 1, -1)).toEqual(["b", "a", "c"]);
    expect(R.moveInOrder(["a", "b", "c"], 1, 1)).toEqual(["a", "c", "b"]);
    expect(R.moveInOrder(["a", "b", "c"], 0, -1)).toEqual(["a", "b", "c"]);
    expect(R.moveInOrder(["a", "b", "c"], 2, 1)).toEqual(["a", "b", "c"]);
  });
});

describe("notes while reading", () => {
  const note = (id: string, createdAt: string): BookNote => ({ id, bookId: "a", body: id, createdAt, updatedAt: createdAt });

  it("reads oldest first, so a journal runs top to bottom", () => {
    const out = R.notesInOrder([note("n3", "2026-10-03T09:00:00Z"), note("n1", "2026-10-01T09:00:00Z"), note("n2", "2026-10-02T09:00:00Z")]);
    expect(out.map((n) => n.id)).toEqual(["n1", "n2", "n3"]);
  });

  it("keeps notes with the same timestamp in the order they were saved", () => {
    const same = "2026-10-01T09:00:00Z";
    const out = R.notesInOrder([note("zz", same), note("aa", same), note("mm", same)]);
    expect(out.map((n) => n.id)).toEqual(["zz", "aa", "mm"]);
  });

  it("tags a note with an optional chapter", () => {
    const withTag = addNote([], "a", "Nice", NOW, "n1", "  Ch. 4 ");
    expect(withTag[0].chapter).toBe("Ch. 4");
    expect(addNote([], "a", "Nice", NOW, "n2", "  ")[0].chapter).toBeUndefined();
    expect("chapter" in addNote([], "a", "Nice", NOW, "n3")[0]).toBe(false);
  });

  it("leaves the chapter alone on an edit that doesn't name one, and clears it with a blank", () => {
    const start = addNote([], "a", "Nice", NOW, "n1", "Ch. 4");
    expect(updateNote(start, "n1", "Nicer", NOW)[0]).toMatchObject({ body: "Nicer", chapter: "Ch. 4" });
    expect(updateNote(start, "n1", "Nicer", NOW, "Ch. 5")[0].chapter).toBe("Ch. 5");
    expect(updateNote(start, "n1", "Nicer", NOW, "")[0].chapter).toBeUndefined();
  });

  it("tidies a chapter tag", () => {
    expect(R.cleanChapter("  Ch.   12 ")).toBe("Ch. 12");
    expect(R.cleanChapter("   ")).toBeUndefined();
    expect(R.cleanChapter(undefined)).toBeUndefined();
    expect(R.cleanChapter("x".repeat(100))).toHaveLength(60);
  });
});

describe("links in notes", () => {
  const links = (t: string) => R.linkify(t).filter((p) => p.kind === "link");
  const rebuilt = (t: string) => R.linkify(t).map((p) => p.text).join("");

  it("makes a website and a YouTube video tappable", () => {
    const out = R.linkify("Map of Middle-earth: https://example.com/map and the talk https://www.youtube.com/watch?v=abc123 too");
    expect(out.filter((p) => p.kind === "link").map((p) => (p.kind === "link" ? p.href : ""))).toEqual([
      "https://example.com/map",
      "https://www.youtube.com/watch?v=abc123",
    ]);
  });

  it("never changes the words: the pieces put back together are exactly what was typed", () => {
    for (const t of ["plain note", "see https://a.com/x, then (https://b.org/y).", "www.thing.com is good!", "https://a.com\nhttps://b.com", ""]) {
      expect(rebuilt(t)).toBe(t);
    }
  });

  it("leaves sentence punctuation out of the link", () => {
    expect(links("Read https://a.com/page.")[0]).toMatchObject({ href: "https://a.com/page", text: "https://a.com/page" });
    expect(links("(see https://a.com/page)")[0]).toMatchObject({ href: "https://a.com/page" });
    expect(links("https://en.wikipedia.org/wiki/Dune_(novel)")[0]).toMatchObject({ href: "https://en.wikipedia.org/wiki/Dune_(novel)" });
    expect(links("wow https://a.com/x!?")[0]).toMatchObject({ href: "https://a.com/x" });
  });

  it("treats a bare www address as a web link", () => {
    expect(links("try www.goodreads.com/book")[0]).toMatchObject({ href: "https://www.goodreads.com/book", text: "www.goodreads.com/book" });
  });

  it("only ever links http and https", () => {
    for (const t of ["javascript:alert(1)", "[x](javascript:alert(1))", "data:text/html,hi", "ftp://a.com/x", "https://nodots"]) {
      expect(links(t)).toEqual([]);
    }
  });

  it("returns plain text as a single piece", () => {
    expect(R.linkify("no links here")).toEqual([{ kind: "text", text: "no links here" }]);
  });
});

describe("on this device", () => {
  const SAMPLE = [book("a", { title: "Alpha" }), book("b", { title: "Beta" }), book("c", { title: "Gamma" })];
  const newRepo = (storage = memoryStorage()) => new LocalBookRepository(storage, SAMPLE);

  it("keeps the queue and its order after closing and reopening", async () => {
    const storage = memoryStorage();
    const first = newRepo(storage);
    await first.addToNext("a");
    await first.addToNext("b");
    await first.addToNext("c");
    await first.reorderNext(["c", "a", "b"]);
    const again = newRepo(storage);
    expect((await again.listMyData()).next.sort((x, y) => x.position - y.position).map((n) => n.bookId)).toEqual(["c", "a", "b"]);
  });

  it("starting a queued book moves it to Reading with today's date and takes it off the queue", async () => {
    const repo = newRepo();
    await repo.addToNext("a");
    await repo.addToNext("b");
    await repo.startReading("a", "2026-10-15");
    expect((await repo.listBooks()).find((x) => x.id === "a")).toMatchObject({ status: "reading", startedOn: "2026-10-15" });
    expect((await repo.listMyData()).next.map((n) => n.bookId)).toEqual(["b"]);
  });

  it("setting a queued book to Reading by status also takes it off the queue", async () => {
    const repo = newRepo();
    await repo.addToNext("a");
    await repo.setStatus("a", "reading");
    expect((await repo.listMyData()).next).toEqual([]);
    expect((await repo.listBooks()).find((x) => x.id === "a")?.startedOn).toBeUndefined();
  });

  it("finishing keeps everything together and leaves the other books reading", async () => {
    const repo = newRepo();
    await repo.startReading("a", "2026-10-01");
    await repo.startReading("b", "2026-10-02");
    await repo.addNote("a", "Strong start", "Ch. 1");
    await repo.finishReading("a", { on: "2026-10-20", rating: 4, take: "Worth it" });
    const books = await repo.listBooks();
    expect(books.find((x) => x.id === "a")).toMatchObject({ status: "read", startedOn: "2026-10-01", finishedOn: "2026-10-20", myRating: 4 });
    expect(books.find((x) => x.id === "b")).toMatchObject({ status: "reading", startedOn: "2026-10-02" });
    expect((await repo.listMyData()).takes).toEqual([expect.objectContaining({ bookId: "a", body: "Worth it" })]);
    expect((await repo.listNotes()).find((n) => n.bookId === "a")?.chapter).toBe("Ch. 1");
  });

  it("won't queue a book that is already read", async () => {
    const repo = newRepo();
    await repo.setStatus("a", "read");
    await repo.addToNext("a");
    expect((await repo.listMyData()).next).toEqual([]);
  });

  it("saved data from before the queue existed still loads, with an empty queue", async () => {
    const storage = memoryStorage({ "book-archive:v1": JSON.stringify({ version: 1, books: SAMPLE, notes: [] }) });
    const data = await newRepo(storage).listMyData();
    expect(data.next).toEqual([]);
    expect(data.takes).toEqual([]);
  });
});
