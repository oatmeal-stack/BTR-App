import { describe, expect, it } from "vitest";
import type { Book, BookNote } from "@/domain/book";
import { SAMPLE_BOOKS } from "@/data/sampleBooks";
import { removeBook, setReadDetails, markManyRead } from "@/domain/bookActions";
import { matchReadEntry, matchReadList, parseReadLine, parseReadList, similarity, starsFromComment } from "@/domain/readImport";

const NOW = "2026-10-12T12:00:00.000Z";
const book = (id: string, title: string, author?: string, over: Partial<Book> = {}): Book => ({
  id,
  title,
  author,
  status: "want_to_read",
  favorite: false,
  genres: [],
  moods: [],
  sources: [{ source: "x" }],
  createdAt: NOW,
  updatedAt: NOW,
  ...over,
});

describe("reading a pasted line", () => {
  it("takes a bare title", () => {
    expect(parseReadLine("City of Thieves")).toMatchObject({ title: "City of Thieves", author: undefined, rating: undefined });
  });

  it("takes 'Title by Author', 'Title - Author' and 'Title (Author)'", () => {
    expect(parseReadLine("Dune by Frank Herbert")).toMatchObject({ title: "Dune", author: "Frank Herbert" });
    expect(parseReadLine("Watermoon - Yambao")).toMatchObject({ title: "Watermoon", author: "Yambao" });
    expect(parseReadLine("Dune — Frank Herbert")).toMatchObject({ title: "Dune", author: "Frank Herbert" });
    expect(parseReadLine("Piranesi (Susanna Clarke)")).toMatchObject({ title: "Piranesi", author: "Susanna Clarke" });
  });

  it("keeps a comma in a title, and the rest of a title with a colon", () => {
    expect(parseReadLine("I, Robot by Isaac Asimov – OK")).toMatchObject({ title: "I, Robot", author: "Isaac Asimov", comment: "OK" });
    expect(parseReadLine("Yeager: An Autobiography by Chuck Yeager with Leo Janos – loved")).toMatchObject({
      title: "Yeager: An Autobiography",
      author: "Chuck Yeager with Leo Janos",
    });
  });

  it("reads your verdict after a dash as a rating and a note", () => {
    expect(parseReadLine("The Martian by Andy Weir – liked")).toMatchObject({ rating: 4, comment: "liked" });
    expect(parseReadLine("Replay by Ken Grimwood – loved")).toMatchObject({ rating: 5 });
    expect(parseReadLine("Gone With the Wind by Margaret Mitchell – really liked")).toMatchObject({ rating: 4, comment: "really liked" });
    expect(parseReadLine("Foundation by Isaac Asimov – ok - a bit slow")).toMatchObject({ rating: 3, comment: "ok - a bit slow" });
    expect(parseReadLine("The Man in the High Castle by Philip K. Dick – OK - wanted to love but too slow")).toMatchObject({
      title: "The Man in the High Castle",
      author: "Philip K. Dick",
      rating: 3,
    });
  });

  it("hearts a book you called a favorite of all time", () => {
    expect(parseReadLine("The Stand by Stephen King – loved - a favorite of all time")).toMatchObject({ rating: 5, favorite: true });
    expect(parseReadLine("Jack Reacher series by Lee Child – loved - guilty pleasure")).toMatchObject({ rating: 5, favorite: undefined });
  });

  it("works with a verdict but no author, and doesn't mistake a verdict for an author", () => {
    expect(parseReadLine("East of Eden - loved")).toMatchObject({ title: "East of Eden", author: undefined, rating: 5 });
    expect(parseReadLine("East of Eden - John Steinbeck")).toMatchObject({ author: "John Steinbeck", rating: undefined });
  });

  it("only gives stars when your words clearly say it", () => {
    expect(starsFromComment("a classic")).toBeUndefined();
    expect(starsFromComment("")).toBeUndefined();
    expect(starsFromComment("did not like it")).toBe(1);
    expect(starsFromComment("Loved it")).toBe(5);
  });

  it("drops bullets and numbers, blank lines, and keeps order", () => {
    const list = parseReadList("1. Dune\n- The Road\n\n   \n• Station Eleven by Emily St. John Mandel");
    expect(list.map((e) => e.title)).toEqual(["Dune", "The Road", "Station Eleven"]);
  });
});

describe("finding each line in your archive", () => {
  it("matches an exact title with its author as confident", () => {
    const m = matchReadEntry(parseReadLine("Dune by Frank Herbert – loved")!, SAMPLE_BOOKS);
    expect(m.confidence).toBe("high");
    expect(m.candidates[0].book.title).toBe("Dune");
  });

  it("ignores a leading article, accents, punctuation and a first-name initial", () => {
    expect(matchReadEntry(parseReadLine("Hunt for Red October by T. Clancy")!, SAMPLE_BOOKS).candidates[0].book.title).toBe("The Hunt for Red October");
    const books = [book("a", "Pedro Páramo", "Juan Rulfo")];
    expect(matchReadEntry(parseReadLine("pedro paramo by Rulfo")!, books).confidence).toBe("high");
  });

  it("matches with only a title when the title is unmistakable", () => {
    expect(matchReadEntry(parseReadLine("The Road")!, SAMPLE_BOOKS).confidence).toBe("high");
  });

  it("flags a title that fits more than one book, instead of picking for you", () => {
    const books = [book("h", "Men Without Women", "Ernest Hemingway"), book("m", "Men Without Women", "Haruki Murakami")];
    const noAuthor = matchReadEntry(parseReadLine("Men Without Women")!, books);
    expect(noAuthor.confidence).toBe("low");
    expect(noAuthor.candidates).toHaveLength(2);
    expect(matchReadEntry(parseReadLine("Men Without Women by Haruki Murakami")!, books)).toMatchObject({ confidence: "high" });
    expect(matchReadEntry(parseReadLine("Men Without Women by Haruki Murakami")!, books).candidates[0].book.id).toBe("m");
  });

  it("doesn't take the same title by a different author for the same book", () => {
    const m = matchReadEntry(parseReadLine("Dune by Brian Herbert")!, SAMPLE_BOOKS);
    expect(m.confidence).not.toBe("high");
  });

  it("forgives a small spelling slip: trusted when the author agrees, flagged when there's no author to check", () => {
    const withAuthor = matchReadEntry(parseReadLine("Lonsome Dove by Larry McMurtry")!, SAMPLE_BOOKS);
    expect(withAuthor.candidates[0]?.book.title).toBe("Lonesome Dove");
    expect(withAuthor.confidence).toBe("high");
    const titleOnly = matchReadEntry(parseReadLine("Lonsome Dove")!, SAMPLE_BOOKS);
    expect(titleOnly.candidates[0]?.book.title).toBe("Lonesome Dove");
    expect(titleOnly.confidence).toBe("low");
  });

  it("calls a book that isn't there new, not a doubtful match", () => {
    expect(matchReadEntry(parseReadLine("City of Thieves")!, SAMPLE_BOOKS)).toMatchObject({ confidence: "none", candidates: [] });
    expect(matchReadEntry(parseReadLine("Recursion by Blake Crouch")!, SAMPLE_BOOKS).confidence).toBe("none");
  });

  it("offers that author's books for a series, never a look-alike by someone else", () => {
    const books = [
      book("hp", "Harry Potter and the Philosopher's Stone", "J.K. Rowling"),
      book("hole", "Harry Hole series", "Jo Nesbø"),
      book("w", "Other", "Someone"),
    ];
    const m = matchReadEntry(parseReadLine("Harry Potter series by J.K. Rowling – loved")!, books);
    expect(m.confidence).toBe("low");
    expect(m.candidates.map((c) => c.book.id)).toEqual(["hp"]);
  });

  it("is confident when the archive itself has an entry for the series", () => {
    const books = [book("jr", "Jack Reacher series", "Lee Child")];
    expect(matchReadEntry(parseReadLine("Jack Reacher series by Lee Child")!, books).confidence).toBe("high");
  });

  it("matches a book with several authors by any of them", () => {
    expect(matchReadEntry(parseReadLine("Good Omens by Neil Gaiman")!, SAMPLE_BOOKS).confidence).toBe("high");
    const books = [book("y", "Yeager: An Autobiography", "Chuck Yeager")];
    expect(matchReadEntry(parseReadLine("Yeager: An Autobiography by Chuck Yeager with Leo Janos")!, books).confidence).toBe("high");
  });

  it("matches a removed book too (it will be restored)", () => {
    const books = removeBook(SAMPLE_BOOKS, SAMPLE_BOOKS.find((b) => b.title === "Dune")!.id, NOW);
    const m = matchReadEntry(parseReadLine("Dune by Frank Herbert")!, books);
    expect(m.confidence).toBe("high");
    expect(m.candidates[0].book.removedAt).toBeTruthy();
  });

  it("works on a whole pasted list", () => {
    const m = matchReadList("Dune\nZebra Tales by Anna Smith\nthe road", SAMPLE_BOOKS);
    expect(m.map((x) => x.confidence)).toEqual(["high", "none", "high"]);
  });

  it("scores identical strings 1 and unrelated ones low", () => {
    expect(similarity("dune", "dune")).toBe(1);
    expect(similarity("dune", "zzzz")).toBe(0);
    expect(similarity("lonesome dove", "lonsome dove")).toBeGreaterThan(0.8);
    expect(similarity("lonesome dove", "lonsome dove")).toBeLessThan(1); // never above 1
    for (const [x, y] of [["a b", "a b c d"], ["dune", "dune messiah"], ["aa", "aaaa"]]) {
      expect(similarity(x, y)).toBeLessThanOrEqual(1);
      expect(similarity(x, y)).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("setting your reading details", () => {
  const dune = SAMPLE_BOOKS.find((b) => b.title === "Dune")!;

  it("saves a finish date and a 1-5 rating, and a blank clears them", () => {
    let books = setReadDetails(SAMPLE_BOOKS, dune.id, { finishedOn: "2024-05-17", myRating: 5 }, NOW);
    expect(books.find((b) => b.id === dune.id)).toMatchObject({ finishedOn: "2024-05-17", myRating: 5 });
    books = setReadDetails(books, dune.id, {}, NOW);
    expect(books.find((b) => b.id === dune.id)?.finishedOn).toBeUndefined();
    expect(books.find((b) => b.id === dune.id)?.myRating).toBeUndefined();
  });

  it("ignores a rating outside 1-5 and a malformed date", () => {
    for (const bad of [0, 6, -1, Number.NaN]) {
      expect(setReadDetails(SAMPLE_BOOKS, dune.id, { myRating: bad }, NOW).find((b) => b.id === dune.id)?.myRating).toBeUndefined();
    }
    expect(setReadDetails(SAMPLE_BOOKS, dune.id, { finishedOn: "last spring" }, NOW).find((b) => b.id === dune.id)?.finishedOn).toBeUndefined();
  });
});

describe("marking many books read", () => {
  const [a, b, c] = SAMPLE_BOOKS;
  const noNotes: BookNote[] = [];

  it("sets status, rating and favorite, and adds a private note", () => {
    const out = markManyRead(SAMPLE_BOOKS, noNotes, [{ id: a.id, myRating: 5, favorite: true, note: "loved - a favorite of all time", noteId: "n1" }], NOW);
    expect(out.books.find((x) => x.id === a.id)).toMatchObject({ status: "read", myRating: 5, favorite: true });
    expect(out.notes).toMatchObject([{ id: "n1", bookId: a.id, body: "loved - a favorite of all time" }]);
  });

  it("changes only the books named, and never un-hearts a favorite or erases an old rating", () => {
    const hearted = SAMPLE_BOOKS.map((x) => (x.id === b.id ? { ...x, favorite: true, myRating: 4, finishedOn: "2020-01-01" } : x));
    const out = markManyRead(hearted, noNotes, [{ id: b.id }], NOW);
    expect(out.books.find((x) => x.id === b.id)).toMatchObject({ status: "read", favorite: true, myRating: 4, finishedOn: "2020-01-01" });
    expect(out.books.find((x) => x.id === c.id)).toEqual(c);
  });

  it("adds the same note only once, however often it's imported", () => {
    const row = { id: a.id, note: "liked", noteId: "n1" };
    const once = markManyRead(SAMPLE_BOOKS, noNotes, [row], NOW);
    const twice = markManyRead(once.books, once.notes, [{ ...row, noteId: "n2" }], NOW);
    expect(twice.notes).toHaveLength(1);
  });

  it("brings back a removed book only when asked", () => {
    const gone = removeBook(SAMPLE_BOOKS, a.id, NOW);
    expect(markManyRead(gone, noNotes, [{ id: a.id }], NOW).books.find((x) => x.id === a.id)?.removedAt).toBeTruthy();
    const back = markManyRead(gone, noNotes, [{ id: a.id, restore: true }], NOW).books.find((x) => x.id === a.id)!;
    expect(back.removedAt).toBeUndefined();
    expect(back.status).toBe("read");
  });
});
