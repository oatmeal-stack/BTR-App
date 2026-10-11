import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/** Editing and merging books in the real database: the rules a form can't be trusted to keep. */
const sql = (f: string) => readFileSync(join(process.cwd(), "supabase", f), "utf8");
const PASSCODE = "test-passcode";

let db: PGlite;
let T = "";

async function asAnon<T>(run: () => Promise<T>): Promise<T> {
  await db.exec("set role anon");
  try {
    return await run();
  } finally {
    await db.exec("reset role");
  }
}
const rpc = (query: string, params: unknown[]) => asAnon(() => db.query(query, params));
const one = async <R extends object>(query: string, params: unknown[] = []) => (await db.query<R>(query, params)).rows[0];

beforeAll(async () => {
  db = await PGlite.create({ extensions: { pgcrypto } });
  await db.exec(`
    create schema if not exists extensions;
    create role anon nologin;
    create role authenticated nologin;
    grant usage on schema public, extensions to anon, authenticated;
    alter default privileges in schema public grant all on tables to anon, authenticated;
  `);
  await db.exec(sql("schema.sql"));
  await db.exec(sql("set_passcode.sql").replace("CHOOSE-A-PASSCODE", PASSCODE));
  T = (await asAnon(() => db.query<{ t: string }>("select login($1) as t", [PASSCODE]))).rows[0].t;
  // Two copies of the same book, as an import and a hand-typed add might leave them.
  await rpc("select add_book($1, 'a', 'Dune', 'Frank Herbert', 1965, 'First note', 'Fantasy Top 100 UK', 7)", [T]);
  await rpc("select add_book($1, 'b', 'Dune!', 'Herbert', null, 'Second note', 'My additions')", [T]);
}, 120_000);

afterAll(async () => {
  await db.close();
});

const EDIT = (over: Record<string, unknown> = {}) => ({
  id: "a",
  title: "Dune",
  author: "Frank Herbert",
  year: 1965,
  pages: 612,
  cover: "https://example.com/c.jpg",
  genres: ["Sci-fi"],
  moods: ["Epic"],
  note: "Edited note",
  sources: ["Fantasy Top 100 UK"],
  ...over,
});
const update = (e: ReturnType<typeof EDIT>, code = T) =>
  rpc("select update_book($1, $2, $3, $4, $5, $6, $7, $8::text[], $9::text[], $10, $11::text[])", [
    code, e.id, e.title, e.author, e.year, e.pages, e.cover, e.genres, e.moods, e.note, e.sources,
  ]);

describe("update_book", () => {
  it("needs the sign-in token", async () => {
    await expect(update(EDIT(), "wrong")).rejects.toThrow(/Wrong passcode/);
    await expect(update(EDIT(), PASSCODE)).rejects.toThrow(/Wrong passcode/);
  });

  it("saves every field, trimmed", async () => {
    await update(EDIT({ title: "  Dune (Deluxe)  ", cover: " https://example.com/c.jpg " }));
    expect(await one("select title, author, year, page_count, cover_url, genres, moods, source_note from books where id = 'a'")).toEqual({
      title: "Dune (Deluxe)",
      author: "Frank Herbert",
      year: 1965,
      page_count: 612,
      cover_url: "https://example.com/c.jpg",
      genres: ["Sci-fi"],
      moods: ["Epic"],
      source_note: "Edited note",
    });
  });

  it("clears a field when it is left blank", async () => {
    await update(EDIT({ author: "", year: null, pages: null, cover: "", note: "  ", genres: [], moods: [] }));
    expect(await one("select author, year, page_count, cover_url, source_note, genres, moods from books where id = 'a'")).toEqual({
      author: null, year: null, page_count: null, cover_url: null, source_note: null, genres: [], moods: [],
    });
  });

  it("makes the lists exactly what was asked for, keeping the rank of one it stays on", async () => {
    await update(EDIT({ sources: ["Fantasy Top 100 UK", "My wife's picks"] }));
    const rows = (await db.query<{ source: string; rank: number | null }>("select source, rank from book_sources where book_id = 'a' order by source")).rows;
    expect(rows).toEqual([{ source: "Fantasy Top 100 UK", rank: 7 }, { source: "My wife's picks", rank: null }]);
    await update(EDIT({ sources: ["My wife's picks"] }));
    expect((await db.query("select source from book_sources where book_id = 'a'")).rows).toEqual([{ source: "My wife's picks" }]);
    await update(EDIT({ sources: [] })); // never a book on no list
    expect((await db.query("select source from book_sources where book_id = 'a'")).rows).toEqual([{ source: "My additions" }]);
    await update(EDIT({ sources: ["Fantasy Top 100 UK"] }));
  });

  it("refuses a blank title or a page count that isn't positive, and changes nothing", async () => {
    await expect(update(EDIT({ title: "   " }))).rejects.toThrow(/needs a title/);
    await expect(update(EDIT({ pages: 0 }))).rejects.toThrow();
    expect((await one<{ title: string }>("select title from books where id = 'a'")).title).not.toBe("   ");
  });

  it("leaves every other book alone", async () => {
    const other = await one("select title, author, year from books where id = 'b'");
    await update(EDIT({ title: "Dune again" }));
    expect(await one("select title, author, year from books where id = 'b'")).toEqual(other);
    await update(EDIT());
  });
});

describe("merge_books", () => {
  const merge = (keep: string, drop: string, key: string | null = "dune|herbert", code = T) =>
    rpc("select merge_books($1, $2, $3, $4)", [code, keep, drop, key]);

  it("needs the sign-in token", async () => {
    await expect(merge("a", "b", null, "wrong")).rejects.toThrow(/Wrong passcode/);
    expect(await one<{ n: number }>("select count(*)::int as n from books where removed_at is not null")).toEqual({ n: 0 });
  });

  it("moves lists, notes, favorites, progress and gaps onto the kept book, and removes the other copy", async () => {
    await rpc("select set_favorite($1, 'b', true)", [T]);
    await rpc("select set_status($1, 'b', 'reading')", [T]);
    await rpc("select add_note($1, 'n-b', 'b', 'From the second copy')", [T]);
    await db.exec("update books set genres = '{Epic}', page_count = 612 where id = 'b'");
    await update(EDIT({ pages: null, genres: ["Sci-fi"], year: 1965, note: "First note" }));
    await db.exec("update book_sources set rank = 7 where book_id = 'a' and source = 'Fantasy Top 100 UK'");
    await db.exec("insert into book_sources (book_id, source, rank) values ('b', 'Fantasy Top 100 UK', 99)"); // the other copy ranks it differently

    await merge("a", "b");

    const kept = await one<Record<string, unknown>>("select title, year, page_count, favorite, status, genres, source_note from books where id = 'a'");
    expect(kept).toMatchObject({ title: "Dune", year: 1965, page_count: 612, favorite: true, status: "reading" });
    expect((kept.genres as string[]).sort()).toEqual(["Epic", "Sci-fi"]);
    expect(kept.source_note).toBe("First note. Second note");

    const lists = (await db.query<{ source: string; rank: number | null }>("select source, rank from book_sources where book_id = 'a' order by source")).rows;
    expect(lists).toEqual([{ source: "Fantasy Top 100 UK", rank: 7 }, { source: "My additions", rank: null }]); // the kept rank wins
    expect((await db.query("select body from book_notes where book_id = 'a'")).rows).toEqual([{ body: "From the second copy" }]);
    expect(await one<{ n: number }>("select count(*)::int as n from book_notes where book_id = 'b'")).toEqual({ n: 0 });

    expect(await one<{ r: boolean }>("select removed_at is not null as r from books where id = 'b'")).toEqual({ r: true }); // removed, not deleted
    expect(await one<{ n: number }>("select count(*)::int as n from books where id = 'b'")).toEqual({ n: 1 });
    expect(await one("select key, book_id from removed_keys")).toEqual({ key: "dune|herbert", book_id: "b" });
  });

  it("doesn't downgrade the kept book's status or overwrite what it already has", async () => {
    await rpc("select add_book($1, 'c', 'Dune', 'Frank Herbert', 1999, null, 'My additions')", [T]);
    await rpc("select set_status($1, 'a', 'read')", [T]);
    await db.exec("update books set page_count = 100 where id = 'c'");
    await merge("a", "c", null);
    expect(await one("select status, year, page_count from books where id = 'a'")).toEqual({ status: "read", year: 1965, page_count: 612 });
  });

  it("does nothing when asked to merge a book into itself", async () => {
    await merge("a", "a");
    expect(await one<{ r: boolean }>("select removed_at is null as r from books where id = 'a'")).toEqual({ r: true });
  });

  it("can be undone by restoring the removed copy", async () => {
    await rpc("select restore_book($1, 'b')", [T]);
    expect(await one<{ r: boolean }>("select removed_at is null as r from books where id = 'b'")).toEqual({ r: true });
    expect(await one<{ n: number }>("select count(*)::int as n from removed_keys")).toEqual({ n: 0 });
  });
});
