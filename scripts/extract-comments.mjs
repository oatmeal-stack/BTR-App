/**
 * Pulls the reader comments out of the saved NYT Thrillers document into one line each:
 *   n|commenter|text
 * Usage: node scripts/extract-comments.mjs <saved-doc.json> [out-file]
 * The output (third-party comments) stays local and is git-ignored.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const [, , input, output = "data/raw/nyt-thrillers-comments.txt"] = process.argv;
if (!input) {
  console.error("Usage: node scripts/extract-comments.mjs <saved-doc.json> [out-file]");
  process.exit(1);
}

const doc = JSON.parse(readFileSync(input, "utf8")).fileContent;
const body = doc.slice(doc.indexOf("Read 569 comments"));
const blocks = body.split(/\n(?=[^\n]{1,60} commented [^\n]{1,30}\n)/);

const rows = [];
for (const block of blocks) {
  const head = block.match(/^([^\n]{1,60}) commented ([^\n]{1,30})\n/);
  if (!head) continue;
  const lines = block
    .slice(head[0].length)
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  // After the avatar letter and name comes "City · ", then the date, then the comment.
  const where = lines.findIndex((l) => l.includes(" · "));
  let text = lines.slice(where >= 0 ? where + 2 : 3);
  const end = text.findIndex((l) => l === "Recommend");
  if (end >= 0) text = text.slice(0, end);
  while (text.length && /^\d+$/.test(text[text.length - 1])) text.pop();
  const clean = text
    .join(" ")
    .replace(/\s+/g, " ")
    .replace(/\\([!.\-'"()])/g, "$1")
    .trim();
  if (clean) rows.push(`${rows.length + 1}|${head[1].trim()}|${clean}`);
}

mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, rows.join("\n") + "\n");
const names = new Set(rows.map((r) => r.split("|")[1]));
console.log(`${rows.length} comments from ${names.size} readers, ${rows.join("\n").length} characters`);
console.log(rows.slice(0, 3).join("\n"));
