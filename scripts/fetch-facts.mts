/**
 * Finds each book's page count on Open Library (years come from fetch-years.mts instead).
 *   npx tsx scripts/fetch-facts.mts
 * Writes data/facts.psv (id|pages|olYear) and data/facts-missing.txt (no confident match).
 * Re-runnable: books already done are skipped; `--retry-missing` looks again at the ones that failed.
 * Then run scripts/build-seed.ts. Uses the same strict title + author matching as the covers.
 *
 * Open Library's page counts are crowd-sourced and can be a little off, so they only fill blanks and you
 * can fix any one with Edit. Its publication YEARS are wrong for about 1 book in 5, so a year is never taken
 * from here directly: olYear is only kept to cross-check the Wikidata year (build-seed uses a year only when
 * the two agree).
 */
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { lookupDetails } from "../src/lib/openLibrary";

interface SeedBook {
  id: string;
  title: string;
  author?: string;
}

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const books: SeedBook[] = JSON.parse(readFileSync(join(root, "src/data/seedBooks.json"), "utf8"));
const factsPath = join(root, "data/facts.psv");
const missingPath = join(root, "data/facts-missing.txt");
const retry = process.argv.includes("--retry-missing");

const ids = (path: string, sep = "|") =>
  new Set(
    existsSync(path)
      ? readFileSync(path, "utf8")
          .split(/\r?\n/)
          .filter((l) => l && !l.startsWith("#"))
          .map((l) => l.split(sep)[0])
      : [],
  );
if (!existsSync(factsPath)) writeFileSync(factsPath, "# id|pages|Open Library year (cross-check only) (made by scripts/fetch-facts.mts)\n");
const have = ids(factsPath);
const tried = retry ? new Set<string>() : ids(missingPath);
if (retry) writeFileSync(missingPath, "");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** fetch with a user agent, a timeout and a few retries for rate limits and hiccups. */
const politeFetch: typeof fetch = async (input, init) => {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(input, {
        ...init,
        headers: { "User-Agent": "BookArchiveApp/1.0 (personal library; details lookup)" },
        signal: AbortSignal.timeout(30000),
      });
      if (res.ok || (res.status < 500 && res.status !== 429) || attempt >= 3) return res;
    } catch (e) {
      if (attempt >= 3) throw e;
    }
    await sleep(2000 * (attempt + 1));
  }
};

const todo = books.filter((b) => !have.has(b.id) && !tried.has(b.id));
console.log(`${books.length} books, ${have.size} done, ${todo.length} to look up.`);

let found = 0;
let missing = 0;
let done = 0;
const queue = [...todo];
await Promise.all(
  Array.from({ length: 4 }, async () => {
    for (let b = queue.shift(); b; b = queue.shift()) {
      const d = await lookupDetails(b.title, b.author, politeFetch);
      if (d && (d.pageCount || d.year)) {
        appendFileSync(factsPath, `${b.id}|${d.pageCount ?? ""}|${d.year ?? ""}\n`);
        found++;
      } else {
        appendFileSync(missingPath, `${b.id}|${b.title}|${b.author ?? ""}\n`);
        missing++;
      }
      if (++done % 25 === 0) console.log(`  ${done}/${todo.length}  found ${found}, no match ${missing}`);
      await sleep(150);
    }
  }),
);
console.log(`Done. Found ${found}, no confident match for ${missing}. See data/facts.psv and data/facts-missing.txt`);
