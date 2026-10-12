import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LockedOutError, PasscodeRequiredError, type PasscodeStore } from "@/lib/passcode";
import { SupabaseBookRepository, type Db } from "@/repositories/SupabaseBookRepository";

/**
 * Runs the real repository code against the real SQL (schema + seed), in an in-memory Postgres,
 * talking to it the way the app does: as the public "anon" role, through the same functions.
 */
const sql = (f: string) => readFileSync(join(process.cwd(), "supabase", f), "utf8");
const CODE = "test-passcode";

let pg: PGlite;

function plain(v: unknown): unknown {
  if (v instanceof Date) return v.toISOString();
  if (Array.isArray(v)) return v.map(plain);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, plain(x)]));
  return v;
}

async function asAnon<T>(run: () => Promise<T>): Promise<T> {
  await pg.exec("set role anon");
  try {
    return await run();
  } finally {
    await pg.exec("reset role");
  }
}

/** Stands in for the Supabase client, but runs against local Postgres as the public role. */
function makeDb(): Db {
  const fail = (e: unknown) => ({ data: null, error: { message: String((e as Error).message), code: (e as { code?: string }).code } });
  return {
    from: (table) => ({
      select: () => ({
        range: (from, to) =>
          asAnon(async () => {
            try {
              const r = await pg.query(`select * from ${table} order by 1, 2 limit ${to - from + 1} offset ${from}`);
              return { data: plain(r.rows) as unknown[], error: null };
            } catch (e) {
              return fail(e);
            }
          }),
      }),
    }),
    rpc: (fn, args) =>
      asAnon(async () => {
        try {
          const keys = Object.keys(args);
          const call = `select * from ${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(", ")})`;
          const r = await pg.query<Record<string, unknown>>(call, keys.map((k) => args[k]));
          const rows = plain(r.rows) as Record<string, unknown>[];
          const data = fn === "login" ? rows[0].login : fn === "list_my_data" ? rows[0].list_my_data : fn === "list_notes" ? rows : fn === "add_note" ? rows[0] : null;
          return { data, error: null };
        } catch (e) {
          return fail(e);
        }
      }),
  };
}

function memoryStore(initial: string | null = null): PasscodeStore {
  let value = initial;
  return { get: () => value, set: (c) => void (value = c), clear: () => void (value = null) };
}

const unlockedRepo = async () => {
  const repo = new SupabaseBookRepository(makeDb(), memoryStore());
  expect(await repo.unlock(CODE)).toBe(true);
  return repo;
};

beforeAll(async () => {
  pg = await PGlite.create({ extensions: { pgcrypto } });
  await pg.exec(`
    create schema if not exists extensions;
    create role anon nologin;
    create role authenticated nologin;
    grant usage on schema public, extensions to anon, authenticated;
    alter default privileges in schema public grant all on tables to anon, authenticated;
  `);
  await pg.exec(sql("schema.sql"));
  await pg.exec(sql("set_passcode.sql").replace("CHOOSE-A-PASSCODE", CODE));
  await pg.exec(sql("seed.sql"));
}, 120_000);

afterAll(async () => {
  await pg.close();
});

describe("reading the shared library (no passcode needed)", () => {
  it("loads every book with its lists, genres, moods and score in the app's shape", async () => {
    const repo = new SupabaseBookRepository(makeDb(), memoryStore());
    const books = await repo.listBooks();
    expect(books).toHaveLength(586);

    const dove = books.find((b) => b.id === "bk-lonesome-dove-mcmurtry")!;
    expect(dove).toMatchObject({
      title: "Lonesome Dove",
      author: "Larry McMurtry",
      status: "want_to_read",
      favorite: false,
      rating: 9,
      genres: ["Western", "Historical"],
      moods: ["Epic", "Slow burn"],
    });
    expect(dove.sources).toEqual([{ source: "Man Book Club", rank: 152 }]);
    expect(typeof dove.createdAt).toBe("string");

    const long = books.find((b) => b.title.startsWith("The Long Way"))!;
    expect(long.sources.map((s) => s.source)).toEqual(["Fantasy Top 100 UK", "Tough Guy Book Club"]);
    expect(books.find((b) => b.title === "The Wide Wide Sea")!.rating).toBeUndefined();
  });

  it("keeps private notes hidden until unlocked", async () => {
    const repo = new SupabaseBookRepository(makeDb(), memoryStore());
    expect(repo.hasPasscode()).toBe(false);
    expect(await repo.listNotes()).toEqual([]);
  });
});

describe("the passcode", () => {
  it("rejects a wrong passcode and remembers nothing", async () => {
    const store = memoryStore();
    const repo = new SupabaseBookRepository(makeDb(), store);
    expect(await repo.unlock("nope")).toBe(false);
    expect(store.get()).toBeNull();
    expect(repo.hasPasscode()).toBe(false);
  });

  it("remembers a login token (never the passcode), and lock forgets it and signs out", async () => {
    const store = memoryStore();
    const repo = new SupabaseBookRepository(makeDb(), store);
    expect(await repo.unlock(CODE)).toBe(true);
    expect(repo.hasPasscode()).toBe(true);
    const token = store.get()!;
    expect(token).not.toBe(CODE);
    repo.lock();
    expect(repo.hasPasscode()).toBe(false);
    await new Promise((r) => setTimeout(r, 50)); // the sign-out is sent in the background
    // That token is dead on the server too: putting it back doesn't unlock anything.
    const again = new SupabaseBookRepository(makeDb(), memoryStore(token));
    await expect(again.setStatus("bk-dune-herbert", "read")).rejects.toBeInstanceOf(PasscodeRequiredError);
  });

  it("reports a lockout after too many wrong tries, and recovers", async () => {
    await pg.exec("delete from login_failures");
    const repo = new SupabaseBookRepository(makeDb(), memoryStore());
    for (let i = 0; i < 5; i++) expect(await repo.unlock("nope")).toBe(false);
    await expect(repo.unlock("nope")).rejects.toBeInstanceOf(LockedOutError);
    await expect(repo.unlock(CODE)).rejects.toBeInstanceOf(LockedOutError); // even the right one
    await pg.exec("delete from login_failures");
    expect(await repo.unlock(CODE)).toBe(true);
  });

  it("refuses every change while locked, and changes nothing", async () => {
    const repo = new SupabaseBookRepository(makeDb(), memoryStore());
    await expect(repo.setStatus("bk-dune-herbert", "read")).rejects.toBeInstanceOf(PasscodeRequiredError);
    await expect(repo.setFavorite("bk-dune-herbert", true)).rejects.toBeInstanceOf(PasscodeRequiredError);
    await expect(repo.addNote("bk-dune-herbert", "hi")).rejects.toBeInstanceOf(PasscodeRequiredError);
    await expect(repo.addBook({ title: "Sneaky" })).rejects.toBeInstanceOf(PasscodeRequiredError);
    const dune = (await repo.listBooks()).find((b) => b.id === "bk-dune-herbert")!;
    expect(dune).toMatchObject({ status: "want_to_read", favorite: false });
  });

  it("forgets a saved passcode the database no longer accepts, and asks again", async () => {
    const store = memoryStore("an-old-passcode");
    const repo = new SupabaseBookRepository(makeDb(), store);
    await expect(repo.setStatus("bk-dune-herbert", "read")).rejects.toBeInstanceOf(PasscodeRequiredError);
    expect(store.get()).toBeNull();
    expect(await repo.listNotes()).toEqual([]);
  });
});

describe("changes once unlocked", () => {
  it("saves status and favorites where a fresh load (another device) sees them", async () => {
    const repo = await unlockedRepo();
    await repo.setStatus("bk-dune-herbert", "reading");
    await repo.setFavorite("bk-dune-herbert", true);

    const otherDevice = new SupabaseBookRepository(makeDb(), memoryStore());
    const dune = (await otherDevice.listBooks()).find((b) => b.id === "bk-dune-herbert")!;
    expect(dune).toMatchObject({ status: "reading", favorite: true });
  });

  it("adds, lists, edits and deletes private notes", async () => {
    const repo = await unlockedRepo();
    const note = await repo.addNote("bk-dune-herbert", "Reread before camp");
    expect(note).toMatchObject({ bookId: "bk-dune-herbert", body: "Reread before camp" });
    expect((await repo.listNotes()).map((n) => n.body)).toContain("Reread before camp");

    await repo.updateNote(note.id, "Edited");
    expect((await repo.listNotes()).find((n) => n.id === note.id)!.body).toBe("Edited");
    await repo.deleteNote(note.id);
    expect((await repo.listNotes()).find((n) => n.id === note.id)).toBeUndefined();

    // A device that hasn't unlocked never sees notes.
    expect(await new SupabaseBookRepository(makeDb(), memoryStore()).listNotes()).toEqual([]);
  });

  it("adds a new book once, and folds a repeat into the same book", async () => {
    const repo = await unlockedRepo();
    const first = await repo.addBook({ title: "Shōgun", author: "James Clavell", note: "Joe's pick" });
    expect(first.created).toBe(true);

    const again = await repo.addBook({ title: "Shōgun", author: "Clavell", note: "Also on the list" });
    expect(again.created).toBe(false);
    expect(again.book.id).toBe(first.book.id);

    const stored = (await repo.listBooks()).filter((b) => b.title === "Shōgun");
    expect(stored).toHaveLength(1);
    expect(stored[0].sources.map((s) => s.source)).toEqual(["My additions"]);
    expect(stored[0].sourceNote).toBe("Joe's pick · Also on the list");
  });

  it("adding a book that is already on another list tags it with both, never a second copy", async () => {
    const repo = await unlockedRepo();
    const r = await repo.addBook({
      title: "The Long Way to a Small, Angry Planet",
      author: "Becky Chambers",
      sources: [{ source: "Book Club Master List" }],
    });
    expect(r.created).toBe(false);
    const rows = (await repo.listBooks()).filter((b) => b.title.startsWith("The Long Way"));
    expect(rows).toHaveLength(1);
    expect(rows[0].sources.map((s) => s.source)).toEqual([
      "Book Club Master List",
      "Fantasy Top 100 UK",
      "Tough Guy Book Club",
    ]);
  });
});

describe("removing books (shared library)", () => {
  const frankenstein = { id: "bk-frankenstein-shelley", title: "Frankenstein", author: "Mary Shelley" };

  it("refuses while locked", async () => {
    const repo = new SupabaseBookRepository(makeDb(), memoryStore());
    await expect(repo.removeBook(frankenstein)).rejects.toBeInstanceOf(PasscodeRequiredError);
    await expect(repo.restoreBook(frankenstein.id)).rejects.toBeInstanceOf(PasscodeRequiredError);
    const book = (await repo.listBooks()).find((b) => b.id === frankenstein.id)!;
    expect(book.removedAt).toBeUndefined();
  });

  it("is seen by a fresh load (another device), keeps the notes, and restores cleanly", async () => {
    const repo = await unlockedRepo();
    await repo.addNote(frankenstein.id, "Borrow Ana's copy");
    await repo.removeBook(frankenstein);

    const other = await unlockedRepo(); // a second device
    const gone = (await other.listBooks()).find((b) => b.id === frankenstein.id)!;
    expect(gone.removedAt).toBeTruthy();
    expect((await other.listNotes()).map((x) => x.body)).toContain("Borrow Ana's copy"); // kept, not deleted

    await other.restoreBook(frankenstein.id);
    const back = (await (await unlockedRepo()).listBooks()).find((b) => b.id === frankenstein.id)!;
    expect(back.removedAt).toBeUndefined();
    expect(back.sources.length).toBeGreaterThan(0);
  });

  it("adding a removed book again doesn't create a second copy or bring it back", async () => {
    const repo = await unlockedRepo();
    await repo.removeBook(frankenstein);
    const r = await repo.addBook({ title: "frankenstein", author: "Shelley" });
    expect(r.created).toBe(false);
    expect(r.book.removedAt).toBeTruthy();
    const all = (await repo.listBooks()).filter((b) => b.title === "Frankenstein");
    expect(all).toHaveLength(1);
    expect(all[0].removedAt).toBeTruthy();
    await repo.restoreBook(frankenstein.id);
  });
});

describe("editing books (shared library)", () => {
  const book = { id: "bk-frankenstein-shelley", title: "Frankenstein", author: "Mary Shelley" };
  const edit = (over: Partial<import("@/domain/book").BookEdit> = {}): import("@/domain/book").BookEdit => ({
    title: "Frankenstein",
    author: "Mary Shelley",
    year: 1818,
    pageCount: 280,
    coverUrl: undefined,
    genres: ["Gothic"],
    moods: [],
    sourceNote: undefined,
    sources: ["Tough Guy Book Club"],
    ...over,
  });

  it("refuses while locked", async () => {
    const repo = new SupabaseBookRepository(makeDb(), memoryStore());
    await expect(repo.updateBook(book.id, edit())).rejects.toBeInstanceOf(PasscodeRequiredError);
    await expect(repo.mergeBooks({ id: book.id }, { id: "x", title: "X" })).rejects.toBeInstanceOf(PasscodeRequiredError);
  });

  it("saves an edit that another device then sees, including year and page count", async () => {
    const repo = await unlockedRepo();
    await repo.updateBook(book.id, edit({ year: 1818, pageCount: 280, sourceNote: "Borrow Ana's copy" }));
    const seen = (await (await unlockedRepo()).listBooks()).find((b) => b.id === book.id)!;
    expect(seen).toMatchObject({ title: "Frankenstein", year: 1818, pageCount: 280, sourceNote: "Borrow Ana's copy" });
    expect(seen.sources.map((s) => s.source)).toEqual(["Tough Guy Book Club"]);
  });

  it("clears a field that was blanked", async () => {
    const repo = await unlockedRepo();
    await repo.updateBook(book.id, edit({ pageCount: undefined, year: undefined }));
    const seen = (await repo.listBooks()).find((b) => b.id === book.id)!;
    expect(seen.pageCount).toBeUndefined();
    expect(seen.year).toBeUndefined();
  });

  it("merges a duplicate into the kept book: notes move, the other copy is removed, not deleted", async () => {
    const repo = await unlockedRepo();
    const made = await repo.addBook({ title: "Frankenstein; or, the Modern Prometheus", author: "Shelley", sources: [{ source: "Book Club Master List" }] });
    expect(made.created).toBe(true); // a different title, so it really is a second copy
    await repo.addNote(made.book.id, "From the duplicate");

    await repo.mergeBooks({ id: book.id }, made.book);

    const all = await repo.listBooks();
    expect(all.find((b) => b.id === made.book.id)?.removedAt).toBeTruthy();
    expect(all.find((b) => b.id === book.id)?.sources.map((s) => s.source)).toContain("Book Club Master List");
    expect((await repo.listNotes()).find((n) => n.body === "From the duplicate")?.bookId).toBe(book.id);
  });
});

describe("your lists and drafts (shared library, private)", () => {
  const dune = "bk-dune-herbert";
  const road = "bk-road-mccarthy";

  it("show nothing until signed in, and refuse every change", async () => {
    const repo = new SupabaseBookRepository(makeDb(), memoryStore());
    expect(await repo.listMyData()).toEqual({ lists: [], items: [], inbox: [] });
    await expect(repo.createList({ id: "l-x", name: "Sneaky" })).rejects.toBeInstanceOf(PasscodeRequiredError);
    await expect(repo.addDraft({ id: "d-x", body: "sneaky" })).rejects.toBeInstanceOf(PasscodeRequiredError);
    await expect(repo.addToList("l-x", dune)).rejects.toBeInstanceOf(PasscodeRequiredError);
  });

  it("round-trip through the database and are seen by another device", async () => {
    const repo = await unlockedRepo();
    await repo.createList({ id: "l-couples", name: "Couples Book Club" });
    await repo.createList({ id: "l-rd", name: "Rough Drafts Potentials" });
    await repo.addToList("l-couples", dune);
    await repo.addToList("l-couples", road);
    await repo.addToList("l-rd", dune);
    await repo.reorderList("l-couples", [road, dune]);
    await repo.addDraft({ id: "d-1", body: "That spy novel about Berlin" });
    await repo.setDraftStatus("d-1", "added", dune);

    const other = await (await unlockedRepo()).listMyData();
    expect(other.lists.map((l) => l.name)).toEqual(["Couples Book Club", "Rough Drafts Potentials"]);
    expect(other.items.filter((i) => i.listId === "l-couples").sort((a, b) => a.position - b.position).map((i) => i.bookId)).toEqual([road, dune]);
    expect(other.items.filter((i) => i.bookId === dune).map((i) => i.listId).sort()).toEqual(["l-couples", "l-rd"]);
    expect(other.inbox).toMatchObject([{ id: "d-1", body: "That spy novel about Berlin", status: "added", bookId: dune }]);
  });

  it("can't be read by a device that isn't signed in, even on the same database", async () => {
    const stranger = new SupabaseBookRepository(makeDb(), memoryStore());
    expect((await stranger.listMyData()).lists).toEqual([]);
  });

  it("renames a list, and deleting one leaves every book in the library", async () => {
    const repo = await unlockedRepo();
    await repo.renameList("l-rd", "Rough Drafts Possibles");
    expect((await repo.listMyData()).lists.map((l) => l.name)).toContain("Rough Drafts Possibles");
    const before = (await repo.listBooks()).length;
    await repo.deleteList("l-rd");
    expect((await repo.listMyData()).lists.map((l) => l.id)).toEqual(["l-couples"]);
    expect((await repo.listBooks()).length).toBe(before);
    expect((await repo.listBooks()).find((b) => b.id === dune)).toBeTruthy();
  });
});

describe("what you've read (shared library)", () => {
  const dune = "bk-dune-herbert";
  const road = "bk-road-mccarthy";

  it("refuses while locked", async () => {
    const repo = new SupabaseBookRepository(makeDb(), memoryStore());
    await expect(repo.setReadDetails(dune, { myRating: 5 })).rejects.toBeInstanceOf(PasscodeRequiredError);
    await expect(repo.markManyRead([{ id: dune }])).rejects.toBeInstanceOf(PasscodeRequiredError);
  });

  it("saves a date and a rating that another device sees", async () => {
    const repo = await unlockedRepo();
    await repo.setStatus(dune, "read");
    await repo.setReadDetails(dune, { finishedOn: "2024-05-17", myRating: 4 });
    const seen = (await (await unlockedRepo()).listBooks()).find((b) => b.id === dune)!;
    expect(seen).toMatchObject({ status: "read", finishedOn: "2024-05-17", myRating: 4 });
    await repo.setReadDetails(dune, {});
    expect((await repo.listBooks()).find((b) => b.id === dune)).toMatchObject({ finishedOn: undefined, myRating: undefined });
  });

  it("marks many books read at once with ratings, favorites and notes", async () => {
    const repo = await unlockedRepo();
    await repo.markManyRead([
      { id: dune, myRating: 5, favorite: true, note: "loved - a favorite of all time", noteId: "note-import-1" },
      { id: road, myRating: 3, note: "ok", noteId: "note-import-2" },
    ]);
    const books = await (await unlockedRepo()).listBooks();
    expect(books.find((b) => b.id === dune)).toMatchObject({ status: "read", myRating: 5, favorite: true });
    expect(books.find((b) => b.id === road)).toMatchObject({ status: "read", myRating: 3, favorite: false });
    const notes = await (await unlockedRepo()).listNotes();
    expect(notes.filter((n) => n.bookId === dune).map((n) => n.body)).toContain("loved - a favorite of all time");
  });
});

describe("putting many books on a list at once (shared library)", () => {
  it("refuses while locked, and otherwise keeps the order", async () => {
    const locked = new SupabaseBookRepository(makeDb(), memoryStore());
    await expect(locked.addManyToList("l-x", ["bk-dune-herbert"])).rejects.toBeInstanceOf(PasscodeRequiredError);
    const repo = await unlockedRepo();
    await repo.createList({ id: "l-many", name: "Books previously read" });
    await repo.addManyToList("l-many", ["bk-road-mccarthy", "bk-dune-herbert", "bk-frankenstein-shelley"]);
    const items = (await (await unlockedRepo()).listMyData()).items.filter((i) => i.listId === "l-many").sort((a, b) => a.position - b.position);
    expect(items.map((i) => i.bookId)).toEqual(["bk-road-mccarthy", "bk-dune-herbert", "bk-frankenstein-shelley"]);
  });
});

describe("adding from an Amazon link (shared library)", () => {
  it("saves the pages, cover and Amazon id with a new book", async () => {
    const repo = await unlockedRepo();
    const r = await repo.addBook({ title: "Pompeii", author: "Robert Harris", pageCount: 304, coverUrl: "https://m.media-amazon.com/images/I/61WHiS5vrRL.jpg", asin: "0812974611" });
    expect(r.created).toBe(true);
    const saved = (await (await unlockedRepo()).listBooks()).find((b) => b.id === r.book.id)!;
    expect(saved).toMatchObject({ title: "Pompeii", pageCount: 304, asin: "0812974611", coverUrl: "https://m.media-amazon.com/images/I/61WHiS5vrRL.jpg" });
  });

  it("only fills blanks on a book you already have", async () => {
    const repo = await unlockedRepo();
    const before = (await repo.listBooks()).find((b) => b.id === "bk-dune-herbert")!;
    const r = await repo.addBook({ title: "Dune", author: "Frank Herbert", pageCount: 999, coverUrl: "https://example.com/other.jpg", asin: "0441172717" });
    expect(r.created).toBe(false);
    const after = (await repo.listBooks()).find((b) => b.id === "bk-dune-herbert")!;
    expect(after.coverUrl).toBe(before.coverUrl ?? "https://example.com/other.jpg");
    expect(after.pageCount).toBe(before.pageCount ?? 999);
    expect(after.asin).toBe(before.asin ?? "0441172717");
  });

  it("reads a link through the server-side helper, only while signed in", async () => {
    const calls: unknown[] = [];
    const withInvoke = (store: PasscodeStore) =>
      new SupabaseBookRepository({ ...makeDb(), invoke: async (fn, body) => { calls.push([fn, body]); return { data: { asin: "0743273567", title: "The Great Gatsby", pages: 180 }, error: null }; } }, store);
    expect(await withInvoke(memoryStore()).readAmazonLink("https://a.co/d/x")).toBeNull(); // not signed in: never asked
    expect(calls).toEqual([]);

    const signedIn = memoryStore();
    const repo = withInvoke(signedIn);
    await repo.unlock(CODE);
    const token = signedIn.get()!;
    expect(await repo.readAmazonLink("https://a.co/d/x")).toMatchObject({ title: "The Great Gatsby", pages: 180 });
    expect(calls).toEqual([["amazon-book", { token, url: "https://a.co/d/x" }]]);
  });

  it("returns nothing when the helper is missing or fails", async () => {
    const store = memoryStore();
    const noHelper = new SupabaseBookRepository(makeDb(), store);
    await noHelper.unlock(CODE);
    expect(await noHelper.readAmazonLink("https://a.co/d/x")).toBeNull();
    const failing = new SupabaseBookRepository({ ...makeDb(), invoke: async () => ({ data: null, error: { message: "boom" } }) }, store);
    expect(await failing.readAmazonLink("https://a.co/d/x")).toBeNull();
  });
});
