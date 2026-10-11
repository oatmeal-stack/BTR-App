import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/** Your own lists and your drafts in the real database: private, orderly, and never able to delete a book. */
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
const n = async (query: string) => Number((await db.query<{ n: number }>(query)).rows[0].n);

const mine = async () => (await rpc("select list_my_data($1) as d", [T])).rows[0] as { d: { lists: { id: string; name: string }[]; items: { list_id: string; book_id: string; position: number }[]; inbox: { id: string; body: string; status: string; book_id: string | null }[] } };

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
    insert into books (id, title, author) values ('b1', 'One', 'A'), ('b2', 'Two', 'B'), ('b3', 'Three', 'C');
  `);
}, 120_000);

afterAll(async () => {
  await db.close();
});

describe("privacy", () => {
  it("hides lists, what is on them, and drafts from the public", async () => {
    for (const t of ["my_lists", "my_list_books", "inbox_notes"]) {
      await expect(asAnon(() => db.query(`select * from ${t}`))).rejects.toThrow(/permission denied/);
      await expect(asAnon(() => db.query(`delete from ${t} where true`))).rejects.toThrow(/permission denied/);
    }
  });

  it("refuses every function without the sign-in token, and the passcode itself isn't one", async () => {
    const calls = [
      "select list_my_data($1)",
      "select create_list($1, 'l', 'Sneaky')",
      "select rename_list($1, 'l', 'x')",
      "select delete_list($1, 'l')",
      "select add_to_list($1, 'l', 'b1')",
      "select remove_from_list($1, 'l', 'b1')",
      "select reorder_list($1, 'l', array['b1'])",
      "select add_inbox_note($1, 'd', 'x')",
      "select set_inbox_status($1, 'd', 'dismissed')",
    ];
    for (const bad of ["wrong", PASSCODE]) {
      for (const q of calls) await expect(rpc(q, [bad])).rejects.toThrow(/Wrong passcode/);
    }
    expect(await n("select count(*) as n from my_lists")).toBe(0);
  });
});

describe("lists", () => {
  it("starts empty", async () => {
    expect((await mine()).d).toEqual({ lists: [], items: [], inbox: [] });
  });

  it("creates lists in order, trimmed, once per id", async () => {
    await rpc("select create_list($1, 'l1', '  Couples Book Club  ')", [T]);
    await rpc("select create_list($1, 'l2', 'Rough Drafts Potentials')", [T]);
    await rpc("select create_list($1, 'l1', 'Something else')", [T]); // same id again: ignored
    expect((await mine()).d.lists.map((l) => l.name)).toEqual(["Couples Book Club", "Rough Drafts Potentials"]);
  });

  it("refuses a second list with the same name, ignoring case and spacing, and a blank name", async () => {
    await expect(rpc("select create_list($1, 'l3', ' couples book club ')", [T])).rejects.toThrow();
    await expect(rpc("select create_list($1, 'l3', '   ')", [T])).rejects.toThrow();
    expect(await n("select count(*) as n from my_lists")).toBe(2);
  });

  it("renames a list", async () => {
    await rpc("select rename_list($1, 'l2', 'Rough Drafts Possibles')", [T]);
    expect((await mine()).d.lists.map((l) => l.name)).toContain("Rough Drafts Possibles");
    await rpc("select rename_list($1, 'l2', 'Rough Drafts Potentials')", [T]);
  });

  it("puts a book on several lists, once each, in the order added", async () => {
    await rpc("select add_to_list($1, 'l1', 'b1')", [T]);
    await rpc("select add_to_list($1, 'l1', 'b2')", [T]);
    await rpc("select add_to_list($1, 'l1', 'b1')", [T]); // already there
    await rpc("select add_to_list($1, 'l2', 'b1')", [T]);
    const items = (await mine()).d.items;
    expect(items.filter((i) => i.list_id === "l1").map((i) => [i.book_id, i.position])).toEqual([["b1", 0], ["b2", 1]]);
    expect(items.filter((i) => i.book_id === "b1").map((i) => i.list_id).sort()).toEqual(["l1", "l2"]);
  });

  it("refuses a book that doesn't exist", async () => {
    await expect(rpc("select add_to_list($1, 'l1', 'nope')", [T])).rejects.toThrow();
  });

  it("reorders a list, keeping books you didn't name after the ones you did", async () => {
    await rpc("select add_to_list($1, 'l1', 'b3')", [T]);
    await rpc("select reorder_list($1, 'l1', array['b3', 'b1'])", [T]);
    const order = (await mine()).d.items.filter((i) => i.list_id === "l1").sort((a, b) => a.position - b.position).map((i) => i.book_id);
    expect(order).toEqual(["b3", "b1", "b2"]);
    // another list is untouched
    expect((await mine()).d.items.filter((i) => i.list_id === "l2").map((i) => i.position)).toEqual([0]);
  });

  it("takes a book off one list without touching the other or the book", async () => {
    await rpc("select remove_from_list($1, 'l1', 'b1')", [T]);
    const items = (await mine()).d.items;
    expect(items.some((i) => i.list_id === "l1" && i.book_id === "b1")).toBe(false);
    expect(items.some((i) => i.list_id === "l2" && i.book_id === "b1")).toBe(true);
    expect(await n("select count(*) as n from books where id = 'b1'")).toBe(1);
  });

  it("keeps a removed book's place on its lists, so restoring brings it back", async () => {
    await rpc("select remove_book($1, 'b2')", [T]);
    expect((await mine()).d.items.some((i) => i.list_id === "l1" && i.book_id === "b2")).toBe(true); // hidden by the app, not deleted here
    await rpc("select restore_book($1, 'b2')", [T]);
  });

  it("deleting a list removes the list and what was on it, but never a book", async () => {
    const books = await n("select count(*) as n from books");
    await rpc("select delete_list($1, 'l1')", [T]);
    const d = (await mine()).d;
    expect(d.lists.map((l) => l.id)).toEqual(["l2"]);
    expect(d.items.every((i) => i.list_id === "l2")).toBe(true);
    expect(await n("select count(*) as n from books")).toBe(books);
    expect(await n("select count(*) as n from books where id in ('b1', 'b2', 'b3')")).toBe(3);
  });
});

describe("drafts", () => {
  it("saves a draft exactly as typed (trimmed at the ends), once per id", async () => {
    await rpc("select add_inbox_note($1, 'd1', E'  That spy novel about Berlin\\nMark mentioned  ')", [T]);
    await rpc("select add_inbox_note($1, 'd1', 'a different body')", [T]);
    await rpc("select add_inbox_note($1, 'd2', 'second one')", [T]);
    const inbox = (await mine()).d.inbox;
    expect(inbox.map((x) => x.id)).toEqual(["d2", "d1"]); // newest first
    expect(inbox.find((x) => x.id === "d1")?.body).toBe("That spy novel about Berlin\nMark mentioned");
    expect(inbox.every((x) => x.status === "new")).toBe(true);
  });

  it("refuses an empty draft", async () => {
    await expect(rpc("select add_inbox_note($1, 'd3', '   ')", [T])).rejects.toThrow();
  });

  it("changes only the status, and remembers the book a draft became", async () => {
    await rpc("select set_inbox_status($1, 'd1', 'added', 'b1')", [T]);
    await rpc("select set_inbox_status($1, 'd2', 'dismissed')", [T]);
    let inbox = (await mine()).d.inbox;
    expect(inbox.find((x) => x.id === "d1")).toMatchObject({ status: "added", book_id: "b1", body: "That spy novel about Berlin\nMark mentioned" });
    expect(inbox.find((x) => x.id === "d2")).toMatchObject({ status: "dismissed", body: "second one" });
    await rpc("select set_inbox_status($1, 'd1', 'new')", [T]); // bring it back: the link to the book is kept
    inbox = (await mine()).d.inbox;
    expect(inbox.find((x) => x.id === "d1")).toMatchObject({ status: "new", book_id: "b1" });
  });

  it("refuses a made-up status", async () => {
    await expect(rpc("select set_inbox_status($1, 'd1', 'archived')", [T])).rejects.toThrow();
  });

  it("never loses the text: there is no way to delete or rewrite a draft", async () => {
    const fns = (await db.query<{ proname: string }>("select proname from pg_proc where proname like '%inbox%' or proname like '%draft%'")).rows.map((r) => r.proname).sort();
    expect(fns).toEqual(["add_inbox_note", "set_inbox_status"]);
    expect(await one<{ n: number }>("select count(*)::int as n from inbox_notes")).toEqual({ n: 2 });
  });
});
