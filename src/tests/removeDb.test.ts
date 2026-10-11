import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SEED_BOOKS } from "@/data/seedBooks";
import { importKey } from "@/domain/bookActions";
import { toSeedSql } from "../../scripts/lib/seed";

/**
 * Removing a book in the real database: the row is kept (so it can be restored), a removal needs the
 * sign-in token, and re-running an import never brings a removed book back, even if the import spells
 * it a little differently.
 */
const sql = (f: string) => readFileSync(join(process.cwd(), "supabase", f), "utf8");
const PASSCODE = "test-passcode";
const DUNE = SEED_BOOKS.find((b) => b.id === "bk-dune-herbert")!;
const KEY = importKey(DUNE.title, DUNE.author);

let db: PGlite;
let TOKEN = "";

async function asAnon<T>(run: () => Promise<T>): Promise<T> {
  await db.exec("set role anon");
  try {
    return await run();
  } finally {
    await db.exec("reset role");
  }
}
const n = async (query: string, params: unknown[] = []) => Number((await db.query<{ n: number }>(query, params)).rows[0].n);
const rpc = (query: string, params: unknown[]) => asAnon(() => db.query(query, params));

/** The import, as it would arrive again: the same book under a different id (a different spelling). */
const respelledImport = () =>
  toSeedSql([{ ...DUNE, id: "bk-dune-respelled", title: "Dune", sources: [{ source: "Fantasy Top 100 UK", rank: 1 }] }]);

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
  await db.exec(sql("seed.sql"));
  TOKEN = (await asAnon(() => db.query<{ t: string }>("select login($1) as t", [PASSCODE]))).rows[0].t;
}, 120_000);

afterAll(async () => {
  await db.close();
});

describe("removing and restoring in the database", () => {
  it("needs the sign-in token", async () => {
    await expect(rpc("select remove_book('wrong', 'bk-dune-herbert', 'x')", [])).rejects.toThrow(/Wrong passcode/);
    await expect(rpc("select restore_book($1, 'bk-dune-herbert')", [PASSCODE])).rejects.toThrow(/Wrong passcode/);
    expect(await n("select count(*) as n from books where removed_at is not null")).toBe(0);
  });

  it("keeps the row, its sources and its notes, and the public can see it is removed", async () => {
    const sources = await n("select count(*) as n from book_sources where book_id = 'bk-dune-herbert'");
    await rpc("select add_note($1, 'n1', 'bk-dune-herbert', 'Read before the film')", [TOKEN]);
    await rpc("select remove_book($1, 'bk-dune-herbert', $2)", [TOKEN, KEY]);

    const row = await asAnon(() => db.query<{ removed_at: string | null }>("select removed_at from books where id = 'bk-dune-herbert'"));
    expect(row.rows[0].removed_at).not.toBeNull();
    expect(await n("select count(*) as n from book_sources where book_id = 'bk-dune-herbert'")).toBe(sources);
    expect(await n("select count(*) as n from book_notes where book_id = 'bk-dune-herbert'")).toBe(1);
    expect(await n("select count(*) as n from books")).toBe(SEED_BOOKS.length); // nothing deleted
  });

  it("keeps the first removal time when removed twice", async () => {
    const t1 = (await db.query<{ t: string }>("select removed_at::text as t from books where id = 'bk-dune-herbert'")).rows[0].t;
    await rpc("select remove_book($1, 'bk-dune-herbert', $2)", [TOKEN, KEY]);
    const t2 = (await db.query<{ t: string }>("select removed_at::text as t from books where id = 'bk-dune-herbert'")).rows[0].t;
    expect(t2).toBe(t1);
  });

  it("is not undone by running the whole seed again", async () => {
    await db.exec(sql("seed.sql"));
    expect(await n("select count(*) as n from books where id = 'bk-dune-herbert' and removed_at is not null")).toBe(1);
    expect(await n("select count(*) as n from books")).toBe(SEED_BOOKS.length);
  });

  it("is not undone by an import that spells the book differently", async () => {
    await db.exec(respelledImport());
    expect(await n("select count(*) as n from books where id = 'bk-dune-respelled'")).toBe(0);
    expect(await n("select count(*) as n from book_sources where book_id = 'bk-dune-respelled'")).toBe(0);
  });

  it("restores the book with its notes, and then an import can add it again", async () => {
    await rpc("select restore_book($1, 'bk-dune-herbert')", [TOKEN]);
    const row = await db.query<{ removed_at: string | null }>("select removed_at from books where id = 'bk-dune-herbert'");
    expect(row.rows[0].removed_at).toBeNull();
    expect(await n("select count(*) as n from book_notes where book_id = 'bk-dune-herbert'")).toBe(1);
    expect(await n("select count(*) as n from removed_keys")).toBe(0); // restoring forgets the removal

    await db.exec(respelledImport());
    expect(await n("select count(*) as n from books where id = 'bk-dune-respelled'")).toBe(1);
  });

  it("works without a key too, and keeps the removal list private", async () => {
    await rpc("select remove_book($1, 'bk-dune-herbert')", [TOKEN]);
    expect(await n("select count(*) as n from books where id = 'bk-dune-herbert' and removed_at is not null")).toBe(1);
    expect(await n("select count(*) as n from removed_keys")).toBe(0);
    await expect(asAnon(() => db.query("select * from removed_keys"))).rejects.toThrow(/permission denied/);
    await expect(asAnon(() => db.query("update books set removed_at = null"))).rejects.toThrow(/permission denied/);
  });
});
