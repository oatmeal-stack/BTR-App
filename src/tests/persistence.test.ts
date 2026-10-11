import { describe, expect, it } from "vitest";
import { SAMPLE_BOOKS } from "@/data/sampleBooks";
import { LocalBookRepository, STORAGE_KEY } from "@/repositories/LocalBookRepository";
import { failingStorage, memoryStorage } from "./helpers";

describe("saved library (this device)", () => {
  it("starts from the sample catalog when nothing is saved", async () => {
    const repo = new LocalBookRepository(memoryStorage(), SAMPLE_BOOKS);
    expect(await repo.listBooks()).toHaveLength(SAMPLE_BOOKS.length);
    expect(await repo.listNotes()).toEqual([]);
  });

  it("notes, status and favorites survive a reload", async () => {
    const storage = memoryStorage();
    const id = SAMPLE_BOOKS[3].id;

    const first = new LocalBookRepository(storage, SAMPLE_BOOKS);
    await first.addNote(id, "Reread before camp");
    await first.setStatus(id, "reading");
    await first.setFavorite(id, true);

    const reloaded = new LocalBookRepository(storage, SAMPLE_BOOKS); // a fresh page load
    const book = (await reloaded.listBooks()).find((b) => b.id === id)!;
    expect(book.status).toBe("reading");
    expect(book.favorite).toBe(true);
    expect((await reloaded.listNotes()).map((n) => n.body)).toEqual(["Reread before camp"]);
  });

  it("does not duplicate sample books after reload, and merges in newly added samples", async () => {
    const storage = memoryStorage();
    await new LocalBookRepository(storage, SAMPLE_BOOKS).setStatus(SAMPLE_BOOKS[0].id, "read");

    const saved = JSON.parse(storage.getItem(STORAGE_KEY)!);
    saved.books = saved.books.slice(1); // pretend an older version didn't have the first sample
    storage.setItem(STORAGE_KEY, JSON.stringify(saved));

    const books = await new LocalBookRepository(storage, SAMPLE_BOOKS).listBooks();
    expect(books).toHaveLength(SAMPLE_BOOKS.length);
    expect(new Set(books.map((b) => b.id)).size).toBe(books.length);
  });

  it("adds a book once and returns the existing one on a repeat", async () => {
    const repo = new LocalBookRepository(memoryStorage(), SAMPLE_BOOKS);
    const a = await repo.addBook({ title: "Shogun", author: "James Clavell" });
    const b = await repo.addBook({ title: "Shogun", author: "Clavell" });
    expect(a.created).toBe(true);
    expect(b.created).toBe(false);
    expect(b.book.id).toBe(a.book.id);
    expect((await repo.listBooks()).filter((x) => x.title === "Shogun")).toHaveLength(1);
  });

  it("edits and deletes notes", async () => {
    const repo = new LocalBookRepository(memoryStorage(), SAMPLE_BOOKS);
    const note = await repo.addNote(SAMPLE_BOOKS[0].id, "one");
    await repo.updateNote(note.id, "two");
    expect((await repo.listNotes())[0].body).toBe("two");
    await repo.deleteNote(note.id);
    expect(await repo.listNotes()).toEqual([]);
  });

  it("falls back to the sample catalog if saved data is corrupt", async () => {
    const storage = memoryStorage({ [STORAGE_KEY]: "{not json" });
    expect(await new LocalBookRepository(storage, SAMPLE_BOOKS).listBooks()).toHaveLength(SAMPLE_BOOKS.length);
  });

  it("ignores saved data from an unknown future version instead of crashing", async () => {
    const storage = memoryStorage({ [STORAGE_KEY]: JSON.stringify({ version: 99, books: [], notes: [] }) });
    expect(await new LocalBookRepository(storage, SAMPLE_BOOKS).listBooks()).toHaveLength(SAMPLE_BOOKS.length);
  });

  it("reports a save failure instead of pretending it worked", async () => {
    const repo = new LocalBookRepository(failingStorage(), SAMPLE_BOOKS);
    await expect(repo.setStatus(SAMPLE_BOOKS[0].id, "read")).rejects.toThrow();
  });
});
