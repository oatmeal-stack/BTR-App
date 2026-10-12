import { describe, expect, it } from "vitest";
import { SAMPLE_BOOKS } from "@/data/sampleBooks";
import { removeBook, restoreBook } from "@/domain/bookActions";
import * as L from "@/domain/listActions";
import type { InboxNote, ListItem, MyList } from "@/domain/book";
import { LocalBookRepository } from "@/repositories/LocalBookRepository";
import { memoryStorage } from "./helpers";

const NOW = "2026-10-12T12:00:00.000Z";
const [a, b, c, d] = SAMPLE_BOOKS;

const list = (id: string, name: string, position = 0): MyList => ({ id, name, position, createdAt: NOW });
const item = (listId: string, bookId: string, position: number): ListItem => ({ listId, bookId, position });

describe("naming a list", () => {
  const lists = [list("l1", "Couples Book Club")];

  it("needs a name that isn't already used, ignoring case and spacing", () => {
    expect(L.listNameProblem(lists, "  ")).toMatch(/name/);
    expect(L.listNameProblem(lists, "couples   book club")).toMatch(/already/);
    expect(L.listNameProblem(lists, "Rough Drafts Potentials")).toBeNull();
  });

  it("lets a list keep its own name when renamed", () => {
    expect(L.listNameProblem(lists, "Couples Book Club", "l1")).toBeNull();
  });

  it("creates lists in order, trims the name, and refuses a blank or duplicate", () => {
    let ls = L.createList([], "l1", "  Couples Book Club ", NOW);
    ls = L.createList(ls, "l2", "Personal", NOW);
    expect(ls.map((l) => [l.name, l.position])).toEqual([["Couples Book Club", 0], ["Personal", 1]]);
    expect(L.createList(ls, "l3", "personal", NOW)).toBe(ls);
    expect(L.createList(ls, "l3", "", NOW)).toBe(ls);
  });

  it("renames, but not to a name another list has", () => {
    const ls = [list("l1", "One", 0), list("l2", "Two", 1)];
    expect(L.renameList(ls, "l1", " Uno ").find((l) => l.id === "l1")?.name).toBe("Uno");
    expect(L.renameList(ls, "l1", "two")).toBe(ls);
  });

  it("sorts lists by position", () => {
    expect(L.sortedLists([list("b", "B", 1), list("a", "A", 0)]).map((l) => l.id)).toEqual(["a", "b"]);
  });
});

describe("what is on a list", () => {
  it("adds a book once, at the end, and a book can be on several lists", () => {
    let items: ListItem[] = [];
    items = L.addToList(items, "l1", a.id);
    items = L.addToList(items, "l1", b.id);
    items = L.addToList(items, "l2", a.id);
    expect(L.addToList(items, "l1", a.id)).toBe(items); // already there
    expect(items.filter((i) => i.listId === "l1").map((i) => [i.bookId, i.position])).toEqual([[a.id, 0], [b.id, 1]]);
    expect(L.listIdsForBook(items, a.id).sort()).toEqual(["l1", "l2"]);
  });

  it("takes a book off one list without touching another", () => {
    const items = [item("l1", a.id, 0), item("l2", a.id, 0)];
    expect(L.removeFromList(items, "l1", a.id)).toEqual([item("l2", a.id, 0)]);
  });

  it("shows a list's books in the list's own order", () => {
    const items = [item("l1", c.id, 2), item("l1", a.id, 0), item("l1", b.id, 1), item("l2", d.id, 0)];
    expect(L.booksInList(SAMPLE_BOOKS, items, "l1").map((x) => x.id)).toEqual([a.id, b.id, c.id]);
  });

  it("reorders, and keeps books you didn't name after the ones you did", () => {
    const items = [item("l1", a.id, 0), item("l1", b.id, 1), item("l1", c.id, 2)];
    const out = L.reorderList(items, "l1", [c.id, a.id]);
    expect(L.booksInList(SAMPLE_BOOKS, out, "l1").map((x) => x.id)).toEqual([c.id, a.id, b.id]);
    expect(out.map((i) => i.position).sort()).toEqual([0, 1, 2]);
  });

  it("only reorders the list asked for", () => {
    const items = [item("l1", a.id, 0), item("l1", b.id, 1), item("l2", a.id, 5)];
    const out = L.reorderList(items, "l1", [b.id, a.id]);
    expect(out.find((i) => i.listId === "l2")).toEqual(item("l2", a.id, 5));
  });

  it("deleting a list removes the list and its memberships, never a book", () => {
    const lists = [list("l1", "One"), list("l2", "Two", 1)];
    const items = [item("l1", a.id, 0), item("l2", a.id, 0), item("l2", b.id, 1)];
    const out = L.deleteList(lists, items, "l1");
    expect(out.lists.map((l) => l.id)).toEqual(["l2"]);
    expect(out.items).toEqual([item("l2", a.id, 0), item("l2", b.id, 1)]);
    // The books were never part of this data at all: nothing here can delete one.
    expect(SAMPLE_BOOKS.find((x) => x.id === a.id)).toBeTruthy();
  });
});

describe("a removed book and your lists", () => {
  const items = [item("l1", a.id, 0), item("l1", b.id, 1)];

  it("is hidden from every list, and from the counts", () => {
    const books = removeBook(SAMPLE_BOOKS, a.id, NOW);
    expect(L.booksInList(books, items, "l1").map((x) => x.id)).toEqual([b.id]);
    expect(L.listBookCounts(books, items, [list("l1", "One")]).get("l1")).toBe(1);
  });

  it("comes back with its place on the list when restored", () => {
    const books = restoreBook(removeBook(SAMPLE_BOOKS, a.id, NOW), a.id, NOW);
    expect(L.booksInList(books, items, "l1").map((x) => x.id)).toEqual([a.id, b.id]);
  });
});

describe("drafts", () => {
  const draft = (id: string, status: InboxNote["status"] = "new"): InboxNote => ({ id, body: "x", status, createdAt: NOW });

  it("saves the text as typed, newest first, and ignores an empty one", () => {
    let notes: InboxNote[] = [];
    notes = L.addDraft(notes, "d1", "  That spy novel about Berlin\nMark mentioned  ", NOW);
    notes = L.addDraft(notes, "d2", "second", NOW);
    expect(L.addDraft(notes, "d3", "   ", NOW)).toBe(notes);
    expect(notes.map((n) => n.id)).toEqual(["d2", "d1"]);
    expect(notes[1].body).toBe("That spy novel about Berlin\nMark mentioned"); // inner text untouched
  });

  it("changes only the status, and remembers which book a draft became", () => {
    const notes = [draft("d1")];
    const out = L.setDraftStatus(notes, "d1", "added", "bk-x");
    expect(out[0]).toMatchObject({ status: "added", bookId: "bk-x", body: "x" });
    expect(L.setDraftStatus(out, "d1", "new")[0].bookId).toBe("bk-x"); // bringing it back doesn't lose the link
    expect(L.waitingDrafts([draft("a"), draft("b", "dismissed"), draft("c", "added")]).map((n) => n.id)).toEqual(["a"]);
  });
});

describe("guessing a book from a rough note", () => {
  const g = L.guessBookFromNote;

  it("understands 'Title by Author', dashes and quotes", () => {
    expect(g("The Remains of the Day by Kazuo Ishiguro")).toEqual({ title: "The Remains of the Day", author: "Kazuo Ishiguro" });
    expect(g("Dune - Frank Herbert")).toEqual({ title: "Dune", author: "Frank Herbert" });
    expect(g("Piranesi — Susanna Clarke")).toEqual({ title: "Piranesi", author: "Susanna Clarke" });
    expect(g("Mark said I should read “The Road” by Cormac McCarthy.")).toEqual({ title: "The Road", author: "Cormac McCarthy" });
    expect(g('heard "Station Eleven" on a podcast')).toEqual({ title: "Station Eleven", author: "" });
  });

  it("falls back to the first line as the title, for you to fix", () => {
    expect(g("that spy novel about Berlin\nMark mentioned at dinner")).toEqual({ title: "that spy novel about Berlin", author: "" });
    expect(g("   ")).toEqual({ title: "", author: "" });
  });

  it("doesn't mistake a title containing 'by' in the middle of a word", () => {
    expect(g("Nobody's Fool")).toEqual({ title: "Nobody's Fool", author: "" });
  });
});

describe("lists and drafts on this device", () => {
  const newRepo = (storage = memoryStorage()) => new LocalBookRepository(storage, SAMPLE_BOOKS);

  it("start empty, and survive a reload", async () => {
    const storage = memoryStorage();
    expect(await newRepo(storage).listMyData()).toEqual({ lists: [], items: [], inbox: [] });
    const repo = newRepo(storage);
    await repo.createList({ id: "l1", name: "Couples Book Club" });
    await repo.addToList("l1", a.id);
    await repo.addToList("l1", b.id);
    await repo.reorderList("l1", [b.id, a.id]);
    await repo.addDraft({ id: "d1", body: "a half-remembered title" });
    await repo.setDraftStatus("d1", "dismissed");

    const again = await newRepo(storage).listMyData();
    expect(again.lists.map((l) => l.name)).toEqual(["Couples Book Club"]);
    expect(L.booksInList(SAMPLE_BOOKS, again.items, "l1").map((x) => x.id)).toEqual([b.id, a.id]);
    expect(again.inbox).toMatchObject([{ id: "d1", body: "a half-remembered title", status: "dismissed" }]);
  });

  it("deleting a list leaves its books in the library", async () => {
    const storage = memoryStorage();
    const repo = newRepo(storage);
    await repo.createList({ id: "l1", name: "One" });
    await repo.addToList("l1", a.id);
    await repo.deleteList("l1");
    expect((await newRepo(storage).listMyData()).items).toEqual([]);
    expect((await newRepo(storage).listBooks()).find((x) => x.id === a.id)).toBeTruthy();
  });

  it("keeps saved data from before lists existed working", async () => {
    const storage = memoryStorage();
    await newRepo(storage).setFavorite(a.id, true); // writes the old shape: no lists, items or inbox
    const saved = JSON.parse(storage.getItem("book-archive:v1")!);
    delete saved.lists;
    delete saved.items;
    delete saved.inbox;
    storage.setItem("book-archive:v1", JSON.stringify(saved));
    expect(await newRepo(storage).listMyData()).toEqual({ lists: [], items: [], inbox: [] });
    const repo = newRepo(storage);
    await repo.createList({ id: "l1", name: "New" });
    expect((await newRepo(storage).listMyData()).lists).toHaveLength(1);
  });
});

describe("putting many books on a list at once", () => {
  it("adds them after what's there, in the order given, skipping any already on it", () => {
    const start = [item("l1", a.id, 0), item("l1", b.id, 1)];
    const out = L.addManyToList(start, "l1", [c.id, a.id, d.id]);
    expect(L.booksInList(SAMPLE_BOOKS, out, "l1").map((x) => x.id)).toEqual([a.id, b.id, c.id, d.id]);
    expect(out.filter((i) => i.bookId === a.id)).toHaveLength(1); // a kept its place
  });

  it("starts a new list at the first position, and an empty add changes nothing", () => {
    const out = L.addManyToList([], "l9", [d.id, c.id]);
    expect(out.map((i) => [i.bookId, i.position])).toEqual([[d.id, 0], [c.id, 1]]);
    const some = [item("l1", a.id, 0)];
    expect(L.addManyToList(some, "l1", [])).toBe(some);
  });

  it("works through the device store too", async () => {
    const repo = new LocalBookRepository(memoryStorage(), SAMPLE_BOOKS);
    await repo.createList({ id: "l1", name: "Books previously read" });
    await repo.addManyToList("l1", [c.id, a.id, b.id]);
    const mine = await repo.listMyData();
    expect(L.booksInList(SAMPLE_BOOKS, mine.items, "l1").map((x) => x.id)).toEqual([c.id, a.id, b.id]);
  });
});
