import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PasscodeRequiredError, type PasscodeStore } from "@/lib/passcode";
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
          const data = fn === "check_code" ? rows[0].check_code : fn === "list_notes" ? rows : fn === "add_note" ? rows[0] : null;
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

  it("remembers the right passcode, and lock forgets it", async () => {
    const store = memoryStore();
    const repo = new SupabaseBookRepository(makeDb(), store);
    expect(await repo.unlock(CODE)).toBe(true);
    expect(repo.hasPasscode()).toBe(true);
    repo.lock();
    expect(repo.hasPasscode()).toBe(false);
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
