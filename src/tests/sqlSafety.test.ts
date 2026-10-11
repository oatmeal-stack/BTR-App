import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Supabase refuses any DELETE or UPDATE that has no WHERE clause (its "safeupdate" setting). The
 * in-memory test database doesn't, so a bare `delete from t;` passes every other test here and then
 * fails for real: that is exactly how a correct passcode once got an error. This checks the SQL text
 * instead, so it can't happen again.
 */
const FILES = ["schema.sql", "set_passcode.sql", "covers.sql"];

function withoutComments(sql: string): string {
  return sql.replace(/--[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

/** Every DELETE / UPDATE statement, up to its semicolon. */
function writes(sql: string): string[] {
  const out: string[] = [];
  const re = /\b(delete\s+from\s+\w+|update\s+\w+\s+set)\b[^;]*;?/gi;
  for (const m of withoutComments(sql).matchAll(re)) out.push(m[0].replace(/\s+/g, " ").trim());
  return out;
}

describe("SQL that Supabase will actually accept", () => {
  for (const file of FILES) {
    it(`${file}: every DELETE and UPDATE has a WHERE`, () => {
      const found = writes(readFileSync(join(process.cwd(), "supabase", file), "utf8"));
      const bare = found.filter((s) => !/\bwhere\b/i.test(s));
      expect(bare, `statements with no WHERE in ${file}`).toEqual([]);
    });
  }

  it("the check itself catches a bare DELETE and a bare UPDATE", () => {
    const bad = writes("begin; delete from t; update t set a = 1; delete from t where x = 1;");
    expect(bad.filter((s) => !/\bwhere\b/i.test(s))).toHaveLength(2);
  });
});
