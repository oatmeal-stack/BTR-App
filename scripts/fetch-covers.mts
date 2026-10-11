/**
 * Finds a real cover for each book on Open Library.
 *   npx tsx scripts/fetch-covers.mts
 * Writes data/covers.psv (id|coverId) and data/covers-missing.txt (books with no confident match).
 * Re-runnable: books already in covers.psv are skipped, so an interrupted run just resumes. Use
 * `--retry-missing` to look again at the ones that failed. Then run scripts/build-seed.ts.
 *
 * Covers are looked up by cover ID, never ISBN: ISBN cover requests are rate limited, IDs are not.
 */
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { bestCoverId, coverUrl, parseCovers, pickMatch, type OlDoc } from "./lib/covers";

interface SeedBook {
  id: string;
  title: string;
  author?: string;
}

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const books: SeedBook[] = JSON.parse(readFileSync(join(root, "src/data/seedBooks.json"), "utf8"));
const coversPath = join(root, "data/covers.psv");
const missingPath = join(root, "data/covers-missing.txt");

const have = new Set(existsSync(coversPath) ? parseCovers(readFileSync(coversPath, "utf8")).map((r) => r.id) : []);
const tried = new Set(
  !process.argv.includes("--retry-missing") && existsSync(missingPath)
    ? readFileSync(missingPath, "utf8").split(/\r?\n/).map((l) => l.split("|")[0]).filter(Boolean)
    : [],
);
if (!existsSync(coversPath)) writeFileSync(coversPath, "# id|Open Library cover id (made by scripts/fetch-covers.mts)\n");
if (process.argv.includes("--retry-missing")) writeFileSync(missingPath, "");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const HEADERS = { "User-Agent": "BookArchiveApp/1.0 (personal library; cover lookup)" };

async function search(params: Record<string, string>): Promise<OlDoc[]> {
  const qs = new URLSearchParams({ ...params, limit: "12", fields: "key,title,author_name,cover_i,edition_count,editions,editions.cover_i,editions.language" });
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(`https://openlibrary.org/search.json?${qs}`, { headers: HEADERS, signal: AbortSignal.timeout(30000) }).catch(() => null);
    if (!res) { await sleep(2000 * (attempt + 1)); continue; }
    if (res.ok) return ((await res.json()) as { docs?: OlDoc[] }).docs ?? [];
    if (res.status === 429 || res.status >= 500) await sleep(2000 * (attempt + 1));
    else break;
  }
  throw new Error("search failed");
}

/**
 * The image must really exist and not be Open Library's 1x1 "no cover" stand-in. A 404 means there is
 * truly no image; anything else (timeouts, 5xx, rate limits) is retried and then thrown, so a flaky
 * download is never mistaken for "this book has no cover".
 */
async function coverIsReal(id: number): Promise<boolean> {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(`${coverUrl(id)}?default=false`, { headers: HEADERS, signal: AbortSignal.timeout(20000) });
      if (res.status === 404) return false;
      if (res.ok) return (await res.arrayBuffer()).byteLength > 2500;
    } catch {
      // fall through to the retry
    }
    await sleep(1500 * (attempt + 1));
  }
  throw new Error("cover download kept failing");
}

let found = 0;
let missing = 0;
const todo = books.filter((b) => !have.has(b.id) && !tried.has(b.id));
console.log(`${books.length} books, ${have.size} already have a cover, ${todo.length} to look up.`);

let done = 0;
async function lookup(b: SeedBook) {
  let match = null;
  try {
    // First with the author, then a looser search (author spellings vary); pickMatch re-checks the author either way.
    const last = (b.author ?? "").split(" ").filter(Boolean).pop() ?? "";
    // English editions first, so a Spanish or German jacket isn't picked for an English reader.
    let docs = await search({ title: b.title, ...(last ? { author: last } : {}), language: "eng" });
    match = pickMatch(b.title, b.author, docs);
    if (!match) {
      docs = await search({ title: b.title, ...(last ? { author: last } : {}) });
      match = pickMatch(b.title, b.author, docs);
    }
    if (!match) {
      docs = await search({ q: `${b.title} ${last}`.trim() });
      match = pickMatch(b.title, b.author, docs);
    }
    const coverId = match ? bestCoverId(match) : undefined;
    if (coverId && !(await coverIsReal(coverId))) match = null;
  } catch (e) {
    console.log(`  ! ${b.title}: ${(e as Error).message} (will retry next run)`);
    return;
  }
  const chosen = match ? bestCoverId(match) : undefined;
  if (chosen) {
    appendFileSync(coversPath, `${b.id}|${chosen}\n`);
    found++;
  } else {
    appendFileSync(missingPath, `${b.id}|${b.title}|${b.author ?? ""}\n`);
    missing++;
  }
  if (++done % 25 === 0) console.log(`  ${done}/${todo.length}  found ${found}, no match ${missing}`);
}

// A few lookups at a time: Open Library answers in a few seconds each, so one at a time takes ~40 minutes.
const queue = [...todo];
await Promise.all(
  Array.from({ length: 4 }, async () => {
    for (let b = queue.shift(); b; b = queue.shift()) {
      await lookup(b);
      await sleep(150);
    }
  }),
);
console.log(`Done. Found ${found}, no confident match for ${missing}. See data/covers.psv and data/covers-missing.txt`);
