import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SEED_BOOKS } from "@/data/seedBooks";

/**
 * Runs supabase/schema.sql, set_passcode.sql and seed.sql against a real (in-memory)
 * Postgres, then checks the rules that matter: the library is readable by anyone,
 * nothing can be written without the passcode, and private notes stay private.
 */
const sql = (f: string) => readFileSync(join(process.cwd(), "supabase", f), "utf8");
const PASSCODE = "test-passcode";
/** What a signed-in device holds: the login token, which is what the write functions check. */
let CODE = "";

let db: PGlite;

async function asAnon<T>(run: () => Promise<T>): Promise<T> {
  await db.exec("set role anon");
  try {
    return await run();
  } finally {
    await db.exec("reset role");
  }
}

async function signIn(passcode = PASSCODE): Promise<string> {
  const r = await asAnon(() => db.query<{ t: string | null }>("select login($1) as t", [passcode]));
  return r.rows[0].t as string;
}

async function count(query: string): Promise<number> {
  const r = await db.query<{ n: number }>(query);
  return Number(r.rows[0].n);
}

beforeAll(async () => {
  db = await PGlite.create({ extensions: { pgcrypto } });
  // What a Supabase project already has before our files run.
  await db.exec(`
    create schema if not exists extensions;
    create role anon nologin;
    create role authenticated nologin;
    grant usage on schema public, extensions to anon, authenticated;
    alter default privileges in schema public grant all on tables to anon, authenticated;
  `);
  await db.exec(sql("schema.sql"));
  const passcodeSql = sql("set_passcode.sql");
  expect(passcodeSql.split("CHOOSE-A-PASSCODE")).toHaveLength(2); // placeholder appears exactly once
  await db.exec(passcodeSql.replace("CHOOSE-A-PASSCODE", PASSCODE));
  await db.exec(sql("seed.sql"));
  CODE = await signIn();
}, 120_000);

afterAll(async () => {
  await db.close();
});

describe("seed data in Postgres", () => {
  it("loads every list with the expected number of books", async () => {
    const r = await db.query<{ source: string; n: number }>(
      "select source, count(*)::int as n from book_sources group by source order by source",
    );
    expect(Object.fromEntries(r.rows.map((x) => [x.source, x.n]))).toEqual({
      "Fantasy Top 100 UK": 100,
      "Man Book Club": 165,
      "NYT 50 Thrillers": 124,
      "NYT Spy Novels": 117,
      "Tough Guy Book Club": 100,
    });
    expect(await count("select count(*) as n from books")).toBe(586);
  });

  it("stores a cross-source book once with both lists", async () => {
    expect(
      await count("select count(*) as n from books where title = 'The Long Way to a Small, Angry Planet'"),
    ).toBe(1);
    const s = await db.query<{ source: string }>(
      "select source from book_sources where book_id = (select id from books where title like 'The Long Way%') order by source",
    );
    expect(s.rows.map((x) => x.source)).toEqual(["Fantasy Top 100 UK", "Tough Guy Book Club"]);
  });

  it("keeps every book's original added-order, so Recently added matches the app", async () => {
    const i = SEED_BOOKS.findIndex((b) => b.id === "bk-lonesome-dove-mcmurtry");
    const r = await db.query<{ ts: string }>(
      "select to_char(created_at at time zone 'utc', 'YYYY-MM-DD\"T\"HH24:MI') as ts from books where id = 'bk-lonesome-dove-mcmurtry'",
    );
    const expected = new Date(Date.parse("2026-08-09T12:00:00Z") - i * 60_000).toISOString().slice(0, 16);
    expect(r.rows[0].ts).toBe(expected);
  });

  it("matches the app's own copy of the library field for field", async () => {
    const r = await db.query<{ id: string; title: string; author: string | null; year: number | null; rating: string | null; source_note: string | null; genres: string[]; moods: string[] }>(
      "select id, title, author, year, rating, source_note, genres, moods from books order by id",
    );
    expect(r.rows).toHaveLength(SEED_BOOKS.length);
    const byId = new Map(SEED_BOOKS.map((b) => [b.id, b]));
    for (const row of r.rows) {
      const b = byId.get(row.id)!;
      expect(row.title).toBe(b.title);
      expect(row.author ?? undefined).toBe(b.author);
      expect(row.year ?? undefined).toBe(b.year);
      expect(row.rating === null ? undefined : Number(row.rating)).toBe(b.rating);
      expect(row.source_note ?? undefined).toBe(b.sourceNote);
      expect(row.genres).toEqual(b.genres);
      expect(row.moods).toEqual(b.moods);
    }
  });

  it("keeps scores only where a list gave one", async () => {
    expect(await count("select count(*) as n from books where rating is not null")).toBe(158);
    const r = await db.query<{ rating: string }>("select rating from books where title = 'Lonesome Dove'");
    expect(Number(r.rows[0].rating)).toBe(9);
  });

  it("can be run a second time without duplicating or overwriting anything", async () => {
    await db.query("select set_status($1, $2, 'read')", [CODE, "bk-lonesome-dove-mcmurtry"]);
    await db.exec(sql("seed.sql"));
    expect(await count("select count(*) as n from books")).toBe(586);
    expect(await count("select count(*) as n from book_sources")).toBe(606);
    const r = await db.query<{ status: string }>("select status from books where id = 'bk-lonesome-dove-mcmurtry'");
    expect(r.rows[0].status).toBe("read");
  });
});

describe("who can do what", () => {
  it("lets anyone read books and their lists", async () => {
    const n = await asAnon(() => count("select count(*) as n from books"));
    expect(n).toBe(586);
    expect(await asAnon(() => count("select count(*) as n from book_sources"))).toBe(606);
  });

  it("hides the passcode and the private notes from the public", async () => {
    await expect(asAnon(() => db.query("select * from app_secret"))).rejects.toThrow(/permission denied/);
    await expect(asAnon(() => db.query("select * from book_notes"))).rejects.toThrow(/permission denied/);
    await expect(asAnon(() => db.query("select * from app_sessions"))).rejects.toThrow(/permission denied/);
    await expect(asAnon(() => db.query("select * from login_failures"))).rejects.toThrow(/permission denied/);
  });

  it("blocks writing to any table directly", async () => {
    await expect(
      asAnon(() => db.query("update books set status = 'read' where id = 'bk-dune-herbert'")),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asAnon(() => db.query("insert into books (id, title) values ('x', 'Sneaky')")),
    ).rejects.toThrow(/permission denied/);
    await expect(asAnon(() => db.query("delete from books"))).rejects.toThrow(/permission denied/);
    await expect(
      asAnon(() => db.query("insert into book_notes (id, book_id, body) values ('n', 'bk-dune-herbert', 'x')")),
    ).rejects.toThrow(/permission denied/);
  });

  it("accepts a login token, but not the passcode itself, as the key for changes", async () => {
    const check = (v: string) => asAnon(() => db.query<{ ok: boolean }>("select check_code($1) as ok", [v]));
    expect((await check(CODE)).rows[0].ok).toBe(true);
    expect((await check(PASSCODE)).rows[0].ok).toBe(false);
    expect((await check("nope")).rows[0].ok).toBe(false);
    await expect(asAnon(() => db.query("select set_status($1, 'bk-dune-herbert', 'read')", [PASSCODE]))).rejects.toThrow(/Wrong passcode/);
    expect((await db.query<{ h: string }>("select passcode_hash as h from app_secret")).rows[0].h).not.toContain(PASSCODE);
  });

  it("refuses every change with a wrong passcode and changes nothing", async () => {
    const id = "bk-dune-herbert";
    const before = await db.query<{ cover_url: string | null }>("select cover_url from books where id = $1", [id]);
    const calls: [string, unknown[]][] = [
      ["select set_status($1, $2, 'read')", ["wrong", id]],
      ["select set_favorite($1, $2, true)", ["wrong", id]],
      ["select set_cover($1, $2, 'http://x')", ["wrong", id]],
      ["select add_book($1, 'bk-new', 'New', null, null, null, 'My additions')", ["wrong"]],
      ["select merge_book($1, $2, 'Another list')", ["wrong", id]],
      ["select list_notes($1)", ["wrong"]],
      ["select add_note($1, 'n1', $2, 'hello')", ["wrong", id]],
      ["select update_note($1, 'n1', 'x')", ["wrong"]],
      ["select delete_note($1, 'n1')", ["wrong"]],
    ];
    for (const [query, params] of calls) {
      await expect(asAnon(() => db.query(query, params))).rejects.toThrow(/Wrong passcode/);
    }
    const r = await db.query<{ status: string; favorite: boolean; cover_url: string | null }>(
      "select status, favorite, cover_url from books where id = $1",
      [id],
    );
    expect(r.rows[0]).toEqual({ status: "want_to_read", favorite: false, cover_url: before.rows[0].cover_url });
    expect(r.rows[0].cover_url).not.toBe("http://x");
    expect(await count("select count(*) as n from books where id = 'bk-new'")).toBe(0);
  });
});

describe("changes with the right passcode", () => {
  const id = "bk-dune-herbert";

  it("changes status and favorite, and rejects a made-up status", async () => {
    await asAnon(() => db.query("select set_status($1, $2, 'reading')", [CODE, id]));
    await asAnon(() => db.query("select set_favorite($1, $2, true)", [CODE, id]));
    const r = await db.query<{ status: string; favorite: boolean }>("select status, favorite from books where id = $1", [id]);
    expect(r.rows[0]).toEqual({ status: "reading", favorite: true });
    await expect(
      asAnon(() => db.query("select set_status($1, $2, 'finished')", [CODE, id])),
    ).rejects.toThrow();
  });

  it("adds, lists, edits and deletes private notes, and rejects an empty one", async () => {
    const q = (query: string, params: unknown[]) => asAnon(() => db.query(query, params));
    await q("select add_note($1, 'n1', $2, '  First note  ')", [CODE, id]);
    await q("select add_note($1, 'n2', $2, 'Second note')", [CODE, id]);
    const list = await q("select body from list_notes($1) order by created_at, id", [CODE]);
    expect((list.rows as { body: string }[]).map((r) => r.body)).toEqual(["First note", "Second note"]);

    await q("select update_note($1, 'n1', 'Edited')", [CODE]);
    await q("select delete_note($1, 'n2')", [CODE]);
    const after = await q("select id, body from list_notes($1)", [CODE]);
    expect(after.rows).toEqual([{ id: "n1", body: "Edited" }]);

    await expect(q("select add_note($1, 'n3', $2, '   ')", [CODE, id])).rejects.toThrow();
  });

  it("adds a brand-new book once and ignores a repeat", async () => {
    const add = () =>
      asAnon(() =>
        db.query("select add_book($1, 'bk-shogun-clavell', 'Shōgun', 'James Clavell', null, 'Via Joe', 'My additions')", [CODE]),
      );
    await add();
    await add();
    expect(await count("select count(*) as n from books where id = 'bk-shogun-clavell'")).toBe(1);
    expect(await count("select count(*) as n from book_sources where book_id = 'bk-shogun-clavell'")).toBe(1);
  });

  it("folds an existing book into another list without a duplicate row", async () => {
    const merge = (note: string | null) =>
      asAnon(() => db.query("select merge_book($1, 'bk-shogun-clavell', 'Tough Guy Book Club', 12, $2)", [CODE, note]));
    await merge("Camp pick");
    await merge("Camp pick"); // same note again: not repeated
    const s = await db.query<{ source: string }>(
      "select source from book_sources where book_id = 'bk-shogun-clavell' order by source",
    );
    expect(s.rows.map((r) => r.source)).toEqual(["My additions", "Tough Guy Book Club"]);
    const b = await db.query<{ source_note: string }>("select source_note from books where id = 'bk-shogun-clavell'");
    expect(b.rows[0].source_note).toBe("Via Joe · Camp pick");
  });
});

describe("filling covers on a library that is already live", () => {
  it("fills books with no cover, and never overwrites one that already has a cover", async () => {
    await db.query("update books set cover_url = null where id = 'bk-dune-herbert'");
    await db.query("update books set cover_url = 'https://example.com/mine.jpg' where id = 'bk-just-mercy-stevenson'");
    await db.exec(sql("covers.sql"));
    const r = await db.query<{ id: string; cover_url: string | null }>(
      "select id, cover_url from books where id in ('bk-dune-herbert','bk-just-mercy-stevenson') order by id",
    );
    expect(r.rows[0].cover_url).toMatch(/^https:\/\/covers\.openlibrary\.org\/b\/id\/\d+-M\.jpg$/);
    expect(r.rows[1].cover_url).toBe("https://example.com/mine.jpg");
    await db.exec(sql("covers.sql")); // running it again changes nothing
  });
});

describe("signing in and the lockout", () => {
  const fail = () => asAnon(() => db.query<{ t: string | null }>("select login('wrong') as t"));
  const locked = () => asAnon(() => db.query("select login($1)", [PASSCODE]));
  const failures = () => count("select count(*) as n from login_failures");

  it("returns nothing for a wrong passcode, keeps a count, and never stores the token as-is", async () => {
    await db.exec("delete from login_failures");
    expect((await fail()).rows[0].t).toBeNull();
    expect(await failures()).toBe(1); // the count survives, because a wrong passcode isn't an error
    const token = await signIn();
    expect(token).toMatch(/^[0-9a-f]{48}$/);
    expect(await failures()).toBe(0); // the right passcode clears the slate
    expect(await count(`select count(*) as n from app_sessions where token_hash = '${token}'`)).toBe(0);
  });

  it("locks after 5 wrong tries, refuses even the right passcode, and leaves signed-in devices alone", async () => {
    await db.exec("delete from login_failures");
    const token = await signIn();
    for (let i = 0; i < 5; i++) expect((await fail()).rows[0].t).toBeNull();
    await expect(locked()).rejects.toThrow(/Too many wrong tries/);
    await expect(fail()).rejects.toThrow(/Too many wrong tries/);
    expect(await failures()).toBe(5); // tries made while locked add nothing
    // A phone that is already signed in carries on.
    await asAnon(() => db.query("select set_favorite($1, 'bk-dune-herbert', true)", [token]));
  });

  it("lifts the lockout once the tries are 15 minutes old", async () => {
    await db.exec("update login_failures set at = now() - interval '16 minutes'");
    expect(await signIn()).toMatch(/^[0-9a-f]{48}$/);
  });

  it("also caps a slow guesser at 20 wrong tries a day", async () => {
    await db.exec("delete from login_failures");
    await db.exec("insert into login_failures (at) select now() - interval '2 hours' from generate_series(1, 20)");
    await expect(locked()).rejects.toThrow(/Too many wrong tries/); // none in the last 15 minutes, but 20 today
    await db.exec("update login_failures set at = now() - interval '25 hours'");
    expect(await signIn()).toMatch(/^[0-9a-f]{48}$/);
  });

  it("signs a device out, and ignores a token that has expired", async () => {
    const a = await signIn();
    const b = await signIn();
    const valid = async (t: string) => (await asAnon(() => db.query<{ ok: boolean }>("select check_code($1) as ok", [t]))).rows[0].ok;
    expect(await valid(a)).toBe(true);
    await asAnon(() => db.query("select logout($1)", [a]));
    expect(await valid(a)).toBe(false);
    expect(await valid(b)).toBe(true); // other devices stay signed in
    await db.exec("update app_sessions set expires_at = now() - interval '1 minute'");
    expect(await valid(b)).toBe(false);
    CODE = await signIn();
  });

  it("changing the passcode signs every device out and clears a lockout", async () => {
    await db.exec("insert into login_failures default values");
    await db.exec(sql("set_passcode.sql").replace("CHOOSE-A-PASSCODE", PASSCODE));
    expect(await count("select count(*) as n from app_sessions")).toBe(0);
    expect(await failures()).toBe(0);
    CODE = await signIn();
  });
});
