import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PasscodeStore } from "@/lib/passcode";
import { SupabaseBookRepository, type Db } from "@/repositories/SupabaseBookRepository";

/**
 * Reading now, Next books, Start/Finish, My Take and chapter-tagged notes: the real SQL, run in an in-memory
 * Postgres as the public "anon" role, and the real repository code talking to it.
 */
const sql = (f: string) => readFileSync(join(process.cwd(), "supabase", f), "utf8");
const PASSCODE = "test-passcode";

let pg: PGlite;
let T = "";

async function asAnon<R>(run: () => Promise<R>): Promise<R> {
  await pg.exec("set role anon");
  try {
    return await run();
  } finally {
    await pg.exec("reset role");
  }
}
const rpc = (query: string, params: unknown[] = []) => asAnon(() => pg.query(query, params));
const count = async (query: string) => Number((await pg.query<{ n: number }>(query)).rows[0].n);
const row = async <R extends object>(query: string) => (await pg.query<R>(query)).rows[0];

function plain(v: unknown): unknown {
  if (v instanceof Date) return v.toISOString();
  if (Array.isArray(v)) return v.map(plain);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, plain(x)]));
  return v;
}

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

function memoryStore(): PasscodeStore {
  let value: string | null = null;
  return { get: () => value, set: (c) => void (value = c), clear: () => void (value = null) };
}

let repo: SupabaseBookRepository;
const statusOf = async (id: string) => (await row<{ status: string }>(`select status from books where id = '${id}'`)).status;
const queue = async () => (await repo.listMyData()).next.sort((a, b) => a.position - b.position).map((n) => n.bookId);

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
  await pg.exec(sql("set_passcode.sql").replace("CHOOSE-A-PASSCODE", PASSCODE));
  T = (await asAnon(() => pg.query<{ t: string }>("select login($1) as t", [PASSCODE]))).rows[0].t;
  await pg.exec(`
    insert into books (id, title, author) values
      ('b1', 'One', 'A'), ('b2', 'Two', 'B'), ('b3', 'Three', 'C'), ('b4', 'Four', 'D'), ('b5', 'Five', 'E');
  `);
  repo = new SupabaseBookRepository(makeDb(), memoryStore());
  expect(await repo.unlock(PASSCODE)).toBe(true);
}, 120_000);

afterAll(async () => {
  await pg.close();
});

describe("privacy", () => {
  it("hides the queue and your takes from the public", async () => {
    for (const t of ["next_books", "book_takes"]) {
      await expect(asAnon(() => pg.query(`select * from ${t}`))).rejects.toThrow(/permission denied/);
      await expect(asAnon(() => pg.query(`delete from ${t} where true`))).rejects.toThrow(/permission denied/);
    }
  });

  it("refuses every new function without the sign-in token, and the passcode itself isn't one", async () => {
    const calls = [
      "select add_to_next($1, 'b1')",
      "select remove_from_next($1, 'b1')",
      "select reorder_next($1, array['b1'])",
      "select start_reading($1, 'b1', '2026-10-15')",
      "select finish_reading($1, 'b1', '2026-10-15', 4, 'Good')",
      "select set_my_take($1, 'b1', 'Good')",
      "select add_note($1, 'n', 'b1', 'x', 'Ch. 1')",
    ];
    for (const bad of ["wrong", PASSCODE]) {
      for (const q of calls) await expect(rpc(q, [bad])).rejects.toThrow(/Wrong passcode/);
    }
    expect(await count("select count(*) as n from next_books")).toBe(0);
    expect(await count("select count(*) as n from book_takes")).toBe(0);
  });

  it("keeps a take out of the public books table (the take is not a column there)", async () => {
    const cols = (await asAnon(() => pg.query<{ column_name: string }>("select column_name from information_schema.columns where table_name = 'books'"))).rows.map((r) => r.column_name);
    expect(cols).not.toContain("take");
    expect(cols).toContain("started_on");
  });
});

describe("Next books", () => {
  it("lines books up in the order added, once each", async () => {
    await repo.addToNext("b1");
    await repo.addToNext("b2");
    await repo.addToNext("b3");
    await repo.addToNext("b2"); // again: ignored
    expect(await queue()).toEqual(["b1", "b2", "b3"]);
  });

  it("re-ranks, and the order is saved", async () => {
    await repo.reorderNext(["b3", "b1", "b2"]);
    expect(await queue()).toEqual(["b3", "b1", "b2"]);
    await repo.reorderNext(["b2"]); // books not named keep their order after it
    expect(await queue()).toEqual(["b2", "b3", "b1"]);
    await repo.reorderNext(["b3", "b1", "b2"]);
  });

  it("takes a book off", async () => {
    await repo.addToNext("b4");
    await repo.removeFromNext("b4");
    expect(await queue()).toEqual(["b3", "b1", "b2"]);
  });

  it("won't queue a book that is already being read or read", async () => {
    await pg.exec("update books set status = 'read' where id = 'b5'");
    await repo.addToNext("b5");
    expect(await queue()).not.toContain("b5");
    await pg.exec("update books set status = 'want_to_read' where id = 'b5'");
  });

  it("drops a book from the queue the moment it is set to Reading or Read, whichever way", async () => {
    await repo.setStatus("b2", "reading");
    expect(await queue()).toEqual(["b3", "b1"]);
    await repo.setStatus("b1", "read");
    expect(await queue()).toEqual(["b3"]);
    await repo.setStatus("b1", "want_to_read");
    await repo.setStatus("b2", "want_to_read");
  });
});

describe("Start and Finish", () => {
  it("Start records the day it was pressed and moves the book to Reading, leaving the others alone", async () => {
    await repo.addToNext("b1");
    await repo.startReading("b1", "2026-10-15");
    const books = await repo.listBooks();
    expect(books.find((b) => b.id === "b1")).toMatchObject({ status: "reading", startedOn: "2026-10-15" });
    expect(books.find((b) => b.id === "b2")).toMatchObject({ status: "want_to_read", startedOn: undefined });
    expect(await queue()).toEqual(["b3"]); // it left the queue by itself
  });

  it("a book moved to Reading without pressing Start has no start date", async () => {
    await repo.setStatus("b2", "reading");
    const b2 = (await repo.listBooks()).find((b) => b.id === "b2");
    expect(b2).toMatchObject({ status: "reading", startedOn: undefined });
  });

  it("Finish saves the finish day, rating and take, keeps the start date, and doesn't touch other books", async () => {
    await repo.startReading("b3", "2026-10-01");
    await repo.finishReading("b1", { on: "2026-10-20", rating: 4, take: "  Tight and bleak.  " });
    const books = await repo.listBooks();
    expect(books.find((b) => b.id === "b1")).toMatchObject({ status: "read", startedOn: "2026-10-15", finishedOn: "2026-10-20", myRating: 4 });
    expect(books.find((b) => b.id === "b2")?.status).toBe("reading"); // still going
    expect(books.find((b) => b.id === "b3")).toMatchObject({ status: "reading", startedOn: "2026-10-01" });
    expect((await repo.listMyData()).takes).toEqual([expect.objectContaining({ bookId: "b1", body: "Tight and bleak." })]);
  });

  it("Finish without a rating or take is allowed, and clears an old take", async () => {
    await repo.finishReading("b2", { on: "2026-10-21" });
    expect((await repo.listBooks()).find((b) => b.id === "b2")).toMatchObject({ status: "read", finishedOn: "2026-10-21", myRating: undefined });
    expect((await repo.listMyData()).takes.map((t) => t.bookId)).toEqual(["b1"]);
    await repo.finishReading("b1", { on: "2026-10-20", rating: 4 }); // no take: removes the earlier one
    expect((await repo.listMyData()).takes).toEqual([]);
  });

  it("My Take can be written, rewritten and cleared on its own", async () => {
    await repo.setTake("b1", "First thought");
    await repo.setTake("b1", "Second thought");
    expect((await repo.listMyData()).takes.map((t) => t.body)).toEqual(["Second thought"]);
    await repo.setTake("b1", "   ");
    expect((await repo.listMyData()).takes).toEqual([]);
  });

  it("refuses a rating outside 1 to 5", async () => {
    await expect(repo.finishReading("b3", { on: "2026-10-22", rating: 9 })).rejects.toThrow();
    expect(await statusOf("b3")).toBe("reading");
  });
});

describe("notes with a chapter", () => {
  it("saves the chapter, trimmed, and none when blank", async () => {
    const withChapter = await repo.addNote("b3", "Great opening", "  Ch. 1 ");
    const without = await repo.addNote("b3", "No chapter on this one", "   ");
    expect(withChapter.chapter).toBe("Ch. 1");
    expect(without.chapter).toBeUndefined();
    const stored = (await repo.listNotes()).filter((n) => n.bookId === "b3");
    expect(stored.map((n) => n.chapter)).toEqual(["Ch. 1", undefined]);
  });

  it("keeps the chapter when an edit doesn't mention it, and clears it when blank", async () => {
    const note = await repo.addNote("b3", "Original", "Part Two");
    await repo.updateNote(note.id, "Reworded");
    expect((await repo.listNotes()).find((n) => n.id === note.id)).toMatchObject({ body: "Reworded", chapter: "Part Two" });
    await repo.updateNote(note.id, "Reworded", "Part Three");
    expect((await repo.listNotes()).find((n) => n.id === note.id)?.chapter).toBe("Part Three");
    await repo.updateNote(note.id, "Reworded", "");
    expect((await repo.listNotes()).find((n) => n.id === note.id)?.chapter).toBeUndefined();
  });

  it("an old caller with no chapter still works (three-argument add_note)", async () => {
    const r = await rpc("select * from add_note($1, 'n-old', 'b3', 'Plain note')", [T]);
    expect((r.rows[0] as { chapter: string | null }).chapter).toBeNull();
  });

  it("only one add_note and one update_note exist (no ambiguous overloads)", async () => {
    expect(await count("select count(*) as n from pg_proc where proname = 'add_note'")).toBe(1);
    expect(await count("select count(*) as n from pg_proc where proname = 'update_note'")).toBe(1);
  });
});

describe("merging two copies of a book", () => {
  it("moves the take across and drops the other copy from the queue", async () => {
    await pg.exec("insert into books (id, title, author) values ('m1', 'Dupe', 'X'), ('m2', 'Dupe', 'X')");
    await repo.addToNext("m2");
    await repo.finishReading("m2", { on: "2026-10-22", take: "Kept" });
    await repo.mergeBooks({ id: "m1" }, { id: "m2", title: "Dupe", author: "X" });
    expect((await repo.listMyData()).takes.find((t) => t.bookId === "m1")?.body).toBe("Kept");
    expect(await queue()).not.toContain("m2");
  });
});
