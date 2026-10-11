import { describe, expect, it } from "vitest";
import { SAMPLE_BOOKS } from "@/data/sampleBooks";
import * as a from "@/domain/bookActions";
import { LocalBookRepository } from "@/repositories/LocalBookRepository";
import { memoryStorage } from "./helpers";

const NOW = "2026-10-12T12:00:00.000Z";
const dune = SAMPLE_BOOKS.find((b) => b.title === "Dune")!;

describe("removing a book (soft delete)", () => {
  it("marks the book removed and leaves everything else about it alone", () => {
    const after = a.removeBook(SAMPLE_BOOKS, dune.id, NOW);
    const gone = after.find((b) => b.id === dune.id)!;
    expect(gone.removedAt).toBe(NOW);
    expect({ ...gone, removedAt: undefined, updatedAt: dune.updatedAt }).toEqual({ ...dune, removedAt: undefined });
    expect(after).toHaveLength(SAMPLE_BOOKS.length); // nothing is deleted
  });

  it("restores a removed book exactly as it was", () => {
    const back = a.restoreBook(a.removeBook(SAMPLE_BOOKS, dune.id, NOW), dune.id, "2026-10-13T00:00:00.000Z");
    const restored = back.find((b) => b.id === dune.id)!;
    expect(restored.removedAt).toBeUndefined();
    expect("removedAt" in restored).toBe(false);
    expect({ ...restored, updatedAt: dune.updatedAt }).toEqual(dune);
  });

  it("is hidden from browse and search, in every filter", () => {
    const books = a.removeBook(SAMPLE_BOOKS, dune.id, NOW);
    expect(a.filterBooks(books, {}).some((b) => b.id === dune.id)).toBe(false);
    expect(a.filterBooks(books, { query: "dune" })).toHaveLength(0);
    expect(a.filterBooks(books, { query: "herbert" }).some((b) => b.id === dune.id)).toBe(false);
    for (const s of dune.sources) {
      expect(a.filterBooks(books, { source: s.source }).some((b) => b.id === dune.id)).toBe(false);
    }
    expect(a.filterBooks(books, { status: dune.status }).some((b) => b.id === dune.id)).toBe(false);
    expect(a.filterBooks(books, { genre: dune.genres[0] }).some((b) => b.id === dune.id)).toBe(false);
  });

  it("is never picked at random, however the dice fall", () => {
    const books = a.removeBook(SAMPLE_BOOKS, dune.id, NOW);
    for (let i = 0; i < 2000; i++) {
      expect(a.pickRandom(books)?.id).not.toBe(dune.id);
      expect(a.pickForYou(books, 30).some((b) => b.id === dune.id)).toBe(false);
    }
    // Even when every other book is the excluded one, a removed book is not the fallback.
    const only = a.removeBook([dune], dune.id, NOW);
    expect(a.pickRandom(only)).toBeUndefined();
  });

  it("drops out of the list counts and the genre and mood counts", () => {
    const before = a.listCounts(SAMPLE_BOOKS);
    const after = a.listCounts(a.removeBook(SAMPLE_BOOKS, dune.id, NOW));
    for (const s of dune.sources) {
      expect(after.find((x) => x.source === s.source)!.count).toBe(before.find((x) => x.source === s.source)!.count - 1);
    }
    const g = dune.genres[0];
    expect(a.facetCounts(a.removeBook(SAMPLE_BOOKS, dune.id, NOW), "genres").find((x) => x.value === g)?.count ?? 0).toBe(
      (a.facetCounts(SAMPLE_BOOKS, "genres").find((x) => x.value === g)?.count ?? 0) - 1,
    );
  });

  it("is still found when you add the same book again, so it can't come back as a duplicate", () => {
    const books = a.removeBook(SAMPLE_BOOKS, dune.id, NOW);
    const result = a.addBookToLibrary(books, { title: "Dune", author: "Frank Herbert" }, NOW, "bk-new");
    expect(result.created).toBe(false);
    expect(result.book.id).toBe(dune.id);
    expect(result.book.removedAt).toBe(NOW); // still removed: adding doesn't undo a removal
    expect(result.books).toHaveLength(SAMPLE_BOOKS.length);
  });
});

describe("the key a removal remembers", () => {
  it("ignores case, accents, punctuation, a leading article and the author's first name", () => {
    const k = a.importKey("The Road", "Cormac McCarthy");
    expect(a.importKey("road", "McCarthy")).toBe(k);
    expect(a.importKey("THE ROAD!", "C. McCarthy")).toBe(k);
    expect(a.importKey("Pedro Páramo", "Juan Rulfo")).toBe(a.importKey("pedro paramo", "Rulfo"));
    expect(a.importKey("War & Peace", "Leo Tolstoy")).toBe(a.importKey("War and Peace", "Tolstoy"));
  });

  it("tells different books apart", () => {
    expect(a.importKey("Dune", "Frank Herbert")).not.toBe(a.importKey("Dune Messiah", "Frank Herbert"));
    expect(a.importKey("Dune", "Frank Herbert")).not.toBe(a.importKey("Dune", "Brian Wilson"));
  });
});

describe("removals on this device", () => {
  const book = { id: dune.id, title: dune.title, author: dune.author };

  it("survive a reload, and restoring brings the book back with its notes and favorite", async () => {
    const storage = memoryStorage();
    const first = new LocalBookRepository(storage, SAMPLE_BOOKS);
    await first.setFavorite(dune.id, true);
    await first.addNote(dune.id, "Read before the film");
    await first.removeBook(book);

    const reloaded = new LocalBookRepository(storage, SAMPLE_BOOKS);
    expect((await reloaded.listBooks()).find((b) => b.id === dune.id)?.removedAt).toBeTruthy();
    expect((await reloaded.listNotes()).map((n) => n.body)).toEqual(["Read before the film"]); // kept, not deleted

    await reloaded.restoreBook(dune.id);
    const back = (await new LocalBookRepository(storage, SAMPLE_BOOKS).listBooks()).find((b) => b.id === dune.id)!;
    expect(back.removedAt).toBeUndefined();
    expect(back.favorite).toBe(true);
  });

  it("are not undone when the built-in seed list is merged in again", async () => {
    const storage = memoryStorage();
    await new LocalBookRepository(storage, SAMPLE_BOOKS).removeBook(book);
    // A later app version ships the same seed list again.
    const books = await new LocalBookRepository(storage, SAMPLE_BOOKS).listBooks();
    expect(books.filter((b) => b.id === dune.id)).toHaveLength(1);
    expect(books.find((b) => b.id === dune.id)?.removedAt).toBeTruthy();
    // ...even when the seed spells it differently (different id, same normalized title and author).
    const respelled = SAMPLE_BOOKS.map((b) => (b.id === dune.id ? { ...b, id: "bk-dune-again", title: "Dune" } : b));
    const again = await new LocalBookRepository(storage, respelled).listBooks();
    expect(again.filter((b) => a.isSameBook(b, dune))).toHaveLength(1);
  });

  it("don't create a duplicate when the same book is added again", async () => {
    const storage = memoryStorage();
    const repo = new LocalBookRepository(storage, SAMPLE_BOOKS);
    await repo.removeBook(book);
    const result = await repo.addBook({ title: "dune", author: "Herbert" });
    expect(result.created).toBe(false);
    expect(result.book.removedAt).toBeTruthy();
    expect((await repo.listBooks()).filter((b) => a.isSameBook(b, dune))).toHaveLength(1);
  });
});
