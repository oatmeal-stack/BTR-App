/**
 * Finds the year each book was first published, from Wikidata.
 *   npx tsx scripts/fetch-years.mts
 * Writes data/years.psv (id|year) and data/years-missing.txt. Re-runnable (`--retry-missing` retries failures).
 *
 * Why not Open Library: its first_publish_year is wrong for about 1 book in 5 (Song of Solomon 1634,
 * Frankenstein 2017...). A confidently wrong year on a book page is worse than no year, so the order is:
 * the year from your own lists, then this Wikidata year, then blank. Wikidata only counts when a literary
 * work with the same title AND an author with the same last name has a publication date.
 */
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeText } from "../src/domain/bookActions";
import { authorKey } from "../src/lib/openLibrary";

interface SeedBook {
  id: string;
  title: string;
  author?: string;
}

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const books: SeedBook[] = JSON.parse(readFileSync(join(root, "src/data/seedBooks.json"), "utf8"));
const yearsPath = join(root, "data/years.psv");
const missingPath = join(root, "data/years-missing.txt");
const retry = process.argv.includes("--retry-missing");

const idsIn = (path: string) =>
  new Set(existsSync(path) ? readFileSync(path, "utf8").split(/\r?\n/).filter((l) => l && l[0] !== "#").map((l) => l.split("|")[0]) : []);
if (!existsSync(yearsPath)) writeFileSync(yearsPath, "# id|year first published, from Wikidata (made by scripts/fetch-years.mts)\n");
const have = idsIn(yearsPath);
const tried = retry ? new Set<string>() : idsIn(missingPath);
if (retry) writeFileSync(missingPath, "");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const lit = (s: string) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"@en`;

/** The title before any subtitle, and without a leading article, as extra spellings to try. */
function titleVariants(title: string): string[] {
  const main = title.split(/\s*[:(]|\s+[-–—]\s/)[0].trim();
  const out = new Set([title, main, main.replace(/^(The|A|An)\s+/i, ""), `The ${main}`]);
  return [...out].filter(Boolean);
}

async function wikidataYears(title: string): Promise<{ year: number; author: string }[]> {
  const labels = titleVariants(title).map(lit).join(" ");
  const query = `SELECT ?date ?al WHERE { VALUES ?label { ${labels} } ?w rdfs:label ?label; wdt:P50 ?a; wdt:P577 ?date. ?a rdfs:label ?al. FILTER(LANG(?al) = "en") }`;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(`https://query.wikidata.org/sparql?${new URLSearchParams({ query })}`, {
        headers: { "User-Agent": "BookArchiveApp/1.0 (personal library; publication years)", Accept: "application/sparql-results+json" },
        signal: AbortSignal.timeout(40000),
      });
      if (res.ok) {
        const data = (await res.json()) as { results: { bindings: { date: { value: string }; al: { value: string } }[] } };
        return data.results.bindings.map((b) => ({ year: new Date(b.date.value).getUTCFullYear(), author: b.al.value }));
      }
      if (res.status !== 429 && res.status < 500) break;
    } catch {
      /* retry */
    }
    await sleep(3000 * (attempt + 1));
  }
  throw new Error("Wikidata did not answer");
}

const todo = books.filter((b) => b.author && !have.has(b.id) && !tried.has(b.id));
console.log(`${books.length} books, ${have.size} done, ${todo.length} to look up.`);

let found = 0;
let missing = 0;
let failed = 0;
let done = 0;
for (const b of todo) {
  try {
    const want = authorKey(b.author);
    // Only a work whose author has this last name counts; the earliest publication date of those wins.
    const years = (await wikidataYears(b.title))
      .filter((r) => authorKey(r.author) === want || normalizeText(r.author).includes(want))
      .map((r) => r.year)
      .filter((y) => y > 0 && y <= new Date().getUTCFullYear());
    if (years.length) {
      appendFileSync(yearsPath, `${b.id}|${Math.min(...years)}\n`);
      found++;
    } else {
      appendFileSync(missingPath, `${b.id}|${b.title}|${b.author ?? ""}\n`);
      missing++;
    }
  } catch {
    failed++; // not recorded as missing, so the next run tries it again
  }
  if (++done % 25 === 0) console.log(`  ${done}/${todo.length}  found ${found}, none ${missing}, failed ${failed}`);
  await sleep(400);
}
console.log(`Done. Found ${found}, no year on Wikidata for ${missing}, ${failed} failed (run again). See data/years.psv`);
