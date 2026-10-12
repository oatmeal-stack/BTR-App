import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/** fill_book_details: what an Amazon link adds to a book, filling blanks and never replacing anything. */
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
const row = async (id: string) => (await db.query<{ page_count: number | null; cover_url: string | null; asin: string | null }>("select page_count, cover_url, asin from books where id = $1", [id])).rows[0];

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
    insert into books (id, title) values ('blank', 'Blank'), ('full', 'Full');
    update books set page_count = 300, cover_url = 'https://example.com/old.jpg', asin = '0000000000' where id = 'full';
  `);
}, 120_000);

afterAll(async () => {
  await db.close();
});

describe("fill_book_details", () => {
  it("needs the sign-in token", async () => {
    await expect(rpc("select fill_book_details($1, 'blank', 180, 'https://x/c.jpg', '0743273567')", ["wrong"])).rejects.toThrow(/Wrong passcode/);
    await expect(rpc("select fill_book_details($1, 'blank', 180, 'https://x/c.jpg', '0743273567')", [PASSCODE])).rejects.toThrow(/Wrong passcode/);
    expect(await row("blank")).toEqual({ page_count: null, cover_url: null, asin: null });
  });

  it("fills a book's blanks, and upper-cases the Amazon id", async () => {
    await rpc("select fill_book_details($1, 'blank', 180, ' https://m.media-amazon.com/c.jpg ', ' b0ckm7b2f8 ')", [T]);
    expect(await row("blank")).toEqual({ page_count: 180, cover_url: "https://m.media-amazon.com/c.jpg", asin: "B0CKM7B2F8" });
  });

  it("never replaces a page count, cover or id that's already there", async () => {
    await rpc("select fill_book_details($1, 'full', 999, 'https://x/new.jpg', '0743273567')", [T]);
    expect(await row("full")).toEqual({ page_count: 300, cover_url: "https://example.com/old.jpg", asin: "0000000000" });
  });

  it("fills only what is given, leaving the rest", async () => {
    await db.exec("update books set page_count = null, cover_url = null, asin = null where id = 'blank'");
    await rpc("select fill_book_details($1, 'blank', null, null, '0743273567')", [T]);
    expect(await row("blank")).toEqual({ page_count: null, cover_url: null, asin: "0743273567" });
    await rpc("select fill_book_details($1, 'blank', 250, '', null)", [T]);
    expect(await row("blank")).toEqual({ page_count: 250, cover_url: null, asin: "0743273567" }); // a blank cover address isn't a cover
  });

  it("refuses a page count that isn't positive", async () => {
    await db.exec("update books set page_count = null where id = 'blank'");
    await expect(rpc("select fill_book_details($1, 'blank', 0, null, null)", [T])).rejects.toThrow();
    expect((await row("blank")).page_count).toBeNull();
  });

  it("changes only the book named", async () => {
    await db.exec("update books set page_count = null where id = 'blank'");
    await rpc("select fill_book_details($1, 'blank', 111, null, null)", [T]);
    expect((await row("full")).page_count).toBe(300);
  });
});
