import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/** What you've read, in the real database: dates, ratings, and the bulk "books I've read" import. */
const sql = (f: string) => readFileSync(join(process.cwd(), "supabase", f), "utf8");
const PASSCODE = "test-passcode";

let db: PGlite;
let T = "";

async function asAnon<R>(run: () => Promise<R>): Promise<R> {
  await db.exec("set role anon");
  try {
    return await run();
  } finally {
    await db.exec("reset role");
  }
}
const rpc = (query: string, params: unknown[] = []) => asAnon(() => db.query(query, params));
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
  await db.exec(`
    insert into books (id, title, author) values ('a', 'Alpha', 'A'), ('b', 'Beta', 'B'), ('c', 'Gamma', 'C');
    update books set rating = 7.5 where id = 'a';
  `);
}, 120_000);

afterAll(async () => {
  await db.close();
});

describe("set_read_details", () => {
  it("needs the sign-in token", async () => {
    await expect(rpc("select set_read_details($1, 'a', '2024-05-17', 5)", ["wrong"])).rejects.toThrow(/Wrong passcode/);
    await expect(rpc("select set_read_details($1, 'a', '2024-05-17', 5)", [PASSCODE])).rejects.toThrow(/Wrong passcode/);
  });

  it("saves a finish date and a rating, without touching the Man Book Club score", async () => {
    await rpc("select set_read_details($1, 'a', '2024-05-17', 4)", [T]);
    expect(await one("select finished_on::text as d, my_rating, rating::float as club from books where id = 'a'")).toEqual({ d: "2024-05-17", my_rating: 4, club: 7.5 });
  });

  it("clears them when blank", async () => {
    await rpc("select set_read_details($1, 'a', null, null)", [T]);
    expect(await one("select finished_on, my_rating from books where id = 'a'")).toEqual({ finished_on: null, my_rating: null });
  });

  it("refuses a rating outside 1 to 5, and a made-up date", async () => {
    for (const bad of [0, 6, -2]) await expect(rpc("select set_read_details($1, 'a', null, $2)", [T, bad])).rejects.toThrow();
    await expect(rpc("select set_read_details($1, 'a', 'last spring', 3)", [T])).rejects.toThrow();
    expect(await one("select my_rating from books where id = 'a'")).toEqual({ my_rating: null });
  });

  it("only changes the book named", async () => {
    await rpc("select set_read_details($1, 'b', '2023-01-02', 3)", [T]);
    expect(await one("select my_rating from books where id = 'c'")).toEqual({ my_rating: null });
  });
});

describe("mark_read_bulk", () => {
  const bulk = (rows: object[], code = T) => rpc("select mark_read_bulk($1, $2::jsonb)", [code, JSON.stringify(rows)]);

  it("needs the sign-in token", async () => {
    await expect(bulk([{ id: "a" }], "wrong")).rejects.toThrow(/Wrong passcode/);
    expect(await one("select status from books where id = 'a'")).toEqual({ status: "want_to_read" });
  });

  it("marks books read with their rating, date, favorite and note, in one go", async () => {
    await bulk([
      { id: "a", my_rating: 5, finished_on: "2022-08-01", favorite: true, note_id: "n-a", note: "loved - a favorite of all time" },
      { id: "c", my_rating: 3, note_id: "n-c", note: "ok - a bit slow" },
    ]);
    expect(await one("select status, my_rating, finished_on::text as d, favorite from books where id = 'a'")).toEqual({ status: "read", my_rating: 5, d: "2022-08-01", favorite: true });
    expect(await one("select status, my_rating, favorite from books where id = 'c'")).toEqual({ status: "read", my_rating: 3, favorite: false });
    expect((await db.query("select book_id, body from book_notes order by id")).rows).toEqual([
      { book_id: "a", body: "loved - a favorite of all time" },
      { book_id: "c", body: "ok - a bit slow" },
    ]);
    expect(await one("select status from books where id = 'b'")).toEqual({ status: "want_to_read" }); // not named: untouched
  });

  it("leaves what you don't give as it was (a missing favorite never un-hearts one)", async () => {
    await bulk([{ id: "a" }]);
    expect(await one("select status, my_rating, favorite, finished_on::text as d from books where id = 'a'")).toEqual({ status: "read", my_rating: 5, favorite: true, d: "2022-08-01" });
  });

  it("adds a note once for a given note id, however many times the same import is sent", async () => {
    await bulk([{ id: "c", note_id: "n-c", note: "ok - a bit slow" }]);
    await bulk([{ id: "c", note_id: "n-c", note: "ok - a bit slow" }]);
    expect((await db.query("select id from book_notes where book_id = 'c'")).rows).toEqual([{ id: "n-c" }]);
  });

  it("brings back a removed book only when asked", async () => {
    await rpc("select remove_book($1, 'b', 'beta|b')", [T]);
    await bulk([{ id: "b", my_rating: 4 }]);
    expect(await one("select removed_at is not null as gone, status from books where id = 'b'")).toEqual({ gone: true, status: "read" });
    await bulk([{ id: "b", restore: true }]);
    expect(await one("select removed_at is null as back from books where id = 'b'")).toEqual({ back: true });
    expect(await one<{ n: number }>("select count(*)::int as n from removed_keys")).toEqual({ n: 0 });
  });

  it("refuses a rating out of range and then changes nothing in that call", async () => {
    await db.exec("update books set status = 'want_to_read', my_rating = null where id = 'c'");
    await expect(bulk([{ id: "c", my_rating: 9 }])).rejects.toThrow();
    expect(await one("select status, my_rating from books where id = 'c'")).toEqual({ status: "want_to_read", my_rating: null });
  });

  it("an empty list does nothing", async () => {
    await bulk([]);
  });
});
