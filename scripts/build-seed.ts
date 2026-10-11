/**
 * Builds the library from the five raw lists in data/raw.
 *   npx tsx scripts/build-seed.ts
 * Writes:
 *   src/data/seedBooks.json   what the app shows on this device
 *   supabase/seed.sql         paste into the Supabase SQL editor
 *   supabase/covers.sql       fills jackets on a library that is already live
 * and prints per-list counts so they can be checked against the source sheets.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildBooks, checkTags, parsePsv, parseTags, toCoversSql, toSeedSql, SRC, type Row } from "./lib/seed";
import { applyCovers, parseCovers } from "./lib/covers";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (f: string): Row[] => parsePsv(readFileSync(join(root, "data", "raw", f), "utf8"));

const tagsPath = join(root, "data", "tags.psv");
const tags = existsSync(tagsPath) ? parseTags(readFileSync(tagsPath, "utf8")) : {};

const { books, repeatsWithinList, rowCounts } = buildBooks({
  man: [...read("man-book-club.psv"), ...read("man-book-club-ranks-1-10.psv")],
  tgbc: read("tough-guy-book-club.psv"),
  fantasy: read("fantasy-top-100-uk.psv"),
  spy: read("spy-novels-nyt.psv"),
  nyt: read("nyt-50-thrillers.psv"),
  picks: existsSync(join(root, "data", "raw", "nyt-reader-picks.psv")) ? read("nyt-reader-picks.psv") : [],
  tags,
});

// Jackets found by scripts/fetch-covers.mts. A book with no entry simply has no cover (never guessed).
const coversPath = join(root, "data", "covers.psv");
applyCovers(books, existsSync(coversPath) ? parseCovers(readFileSync(coversPath, "utf8")) : []);

const problems = checkTags(tags, books);
if (problems.length) {
  console.error(["data/tags.psv has problems:", ...problems].join("\n  "));
  process.exit(1);
}

const out = (p: string, text: string) => {
  const full = join(root, p);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, text);
};
out("src/data/seedBooks.json", JSON.stringify(books, null, 1) + "\n");
out("supabase/seed.sql", toSeedSql(books));
out("supabase/covers.sql", toCoversSql(books));

console.log("Rows read per list vs books tagged with that list:");
for (const source of Object.values(SRC)) {
  const tagged = books.filter((b) => b.sources.some((s) => s.source === source)).length;
  console.log(`  ${source.padEnd(22)} rows ${String(rowCounts[source]).padStart(3)}   books ${String(tagged).padStart(3)}`);
}
const total = Object.values(rowCounts).reduce((a, b) => a + b, 0);
console.log(`\nTotal rows ${total} -> ${books.length} unique books (${total - books.length} merged across lists)`);

const multi = books.filter((b) => b.sources.length > 1);
console.log(`\nOn more than one list (${multi.length}):`);
for (const b of multi) console.log(`  ${b.title} (${b.author}) -> ${b.sources.map((s) => s.source).join(" + ")}`);

if (repeatsWithinList.length) {
  console.log(`\nListed twice inside one list, kept once (${repeatsWithinList.length}):`);
  for (const r of repeatsWithinList) console.log(`  ${r.source}: ${r.title}`);
}

console.log(`Covers: ${books.filter((b) => b.coverUrl).length} of ${books.length}`);
console.log(`Tagged: ${books.filter((b) => b.genres.length).length} with genres, ${books.filter((b) => b.moods.length).length} with moods`);
const lastNameOnly = books.filter((b) => b.author && !/\s/.test(b.author)).length;
console.log(`\nAuthors given as a single word (probably last name only): ${lastNameOnly}`);
console.log(`Books with a year: ${books.filter((b) => b.year).length}, with a Man Book Club score: ${books.filter((b) => b.rating !== undefined).length}`);
