/**
 * Writes the seed SQL in chunks of N books (default 100), for loading through a tool that can't
 * take one big query.
 *   npx tsx scripts/write-seed-chunks.ts <out-dir> [size]
 * Each chunk is safe to run on its own and safe to run again.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SEED_BOOKS } from "../src/data/seedBooks";
import { toSeedSql } from "./lib/seed";

const [, , outDir, sizeArg] = process.argv;
if (!outDir) {
  console.error("Usage: npx tsx scripts/write-seed-chunks.ts <out-dir> [size]");
  process.exit(1);
}
const size = Number(sizeArg ?? 100);
mkdirSync(outDir, { recursive: true });

let n = 0;
for (let i = 0; i < SEED_BOOKS.length; i += size) {
  n += 1;
  const file = join(outDir, `seed-part-${String(n).padStart(2, "0")}.sql`);
  writeFileSync(file, toSeedSql(SEED_BOOKS, i, i + size));
  console.log(`${file}  books ${i + 1}-${Math.min(i + size, SEED_BOOKS.length)}`);
}
