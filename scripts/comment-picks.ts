/**
 * Counts how many DIFFERENT readers name each candidate book/series/author in the NYT Thrillers
 * comments, and keeps the ones named by 2 or more.
 *   npx tsx scripts/comment-picks.ts            -> writes data/raw/nyt-reader-picks.psv
 *   npx tsx scripts/comment-picks.ts --verbose   -> also lists the readers behind each count
 *
 * kind:
 *   title    one specific book
 *   series   a named series
 *   author   an author named without a specific title (added as "<Author> novels")
 *   existing a book already in the library; it just gains the NYT list and a note
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

type Kind = "title" | "series" | "author" | "existing";
interface Spec {
  title: string;
  author: string;
  kind: Kind;
  re: RegExp;
  /** Title shown in the library. Defaults to "<Author> novels" for authors, else the title. */
  display?: string;
}

const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ø/gi, "o")
    .replace(/[’‘]/g, "'")
    .toLowerCase();

const SPECS: Spec[] = [
  // ---- specific books ----
  { title: "Strange Sally Diamond", author: "Liz Nugent", kind: "title", re: /strange sally diamond/ },
  { title: "Descent", author: "Tim Johnston", kind: "title", re: /tim johnston/ },
  { title: "The Crimson Petal and the White", author: "Michel Faber", kind: "title", re: /crimson petal/ },
  { title: "Slammerkin", author: "Emma Donoghue", kind: "title", re: /slammerkin/ },
  { title: "The Devotion of Suspect X", author: "Keigo Higashino", kind: "title", re: /devotion of suspect x/ },
  { title: "Smilla's Sense of Snow", author: "Peter Høeg", kind: "title", re: /smilla|peter hoeg/ },
  { title: "Everybody Knows", author: "Jordan Harper", kind: "title", re: /everybody knows/ },
  { title: "The Keeper of Lost Causes", author: "Jussi Adler-Olsen", kind: "title", re: /keeper of lost causes/ },
  { title: "Mr. Mercedes", author: "Stephen King", kind: "title", re: /mr\.? mercedes/ },
  { title: "The Poet", author: "Michael Connelly", kind: "title", re: /\bthe poet\b/ },
  { title: "The Firm", author: "John Grisham", kind: "title", re: /\bthe firm\b/ },
  { title: "Presumed Innocent", author: "Scott Turow", kind: "title", re: /presumed innocent/ },
  { title: "The Silence of the Lambs", author: "Thomas Harris", kind: "title", re: /silence of the lambs/ },
  { title: "Red Dragon", author: "Thomas Harris", kind: "title", re: /red dragon/ },
  { title: "Devil in a Blue Dress", author: "Walter Mosley", kind: "title", re: /devil in a blue dress/ },
  { title: "Before the Fall", author: "Noah Hawley", kind: "title", re: /before the fall/ },
  { title: "Two Nights in Lisbon", author: "Chris Pavone", kind: "title", re: /two nights in lisbon/ },
  { title: "Bangkok 8", author: "John Burdett", kind: "title", re: /bangkok 8/ },
  { title: "The Woman in the Window", author: "A. J. Finn", kind: "title", re: /woman in the window/ },
  { title: "Five Decembers", author: "James Kestrel", kind: "title", re: /five decembers/ },
  { title: "The Substitution Order", author: "Martin Clark", kind: "title", re: /substitution order/ },
  { title: "The Ruins", author: "Scott Smith", kind: "title", re: /\bthe ruins\b/ },
  { title: "Out", author: "Natsuo Kirino", kind: "title", re: /kirino|loved out!|out is fabulous/ },
  { title: "The Daughter of Time", author: "Josephine Tey", kind: "title", re: /daughter of time/ },
  { title: "The Nightingale", author: "Kristin Hannah", kind: "title", re: /the nightingale/ },
  { title: "A Place of Execution", author: "Val McDermid", kind: "title", re: /place of execution/ },
  { title: "The Power of the Dog", author: "Don Winslow", kind: "title", re: /power of the dog/ },

  // ---- named series ----
  { title: "Cal Hooper trilogy", author: "Tana French", kind: "series", re: /cal hooper|the searcher|the hunter|the keeper(?! of lost)/ },
  { title: "Jackson Brodie series", author: "Kate Atkinson", kind: "series", re: /jackson brod(ie|y)/ },
  { title: "Kurt Wallander series", author: "Henning Mankell", kind: "series", re: /mankell|wallender|wallander/ },
  { title: "Harry Hole series", author: "Jo Nesbø", kind: "series", re: /nesbo|harry hole|harry anywhere/ },
  { title: "Dave Robicheaux series", author: "James Lee Burke", kind: "series", re: /james lee burke|\bburke\b|robicheaux/ },
  { title: "Cormoran Strike series", author: "Robert Galbraith", kind: "series", re: /galbraith|cormoran|strike books/ },
  { title: "Pendergast series", author: "Douglas Preston and Lincoln Child", kind: "series", re: /preston|pendergast|lincoln child/ },
  { title: "Jane Whitefield series", author: "Thomas Perry", kind: "series", re: /whitefield/ },
  { title: "Butcher's Boy series", author: "Thomas Perry", kind: "series", re: /butcher'?s boy/ },
  { title: "Sean Duffy series", author: "Adrian McKinty", kind: "series", re: /sean duffy/ },
  { title: "Harry Bosch series", author: "Michael Connelly", kind: "series", re: /\bbosch\b|ballard/ },
  { title: "Jack Reacher series", author: "Lee Child", kind: "series", re: /reacher|lee child/ },
  { title: "Sue Grafton alphabet series", author: "Sue Grafton", kind: "series", re: /grafton|gratton/ },
  { title: "V.I. Warshawski series", author: "Sara Paretsky", kind: "series", re: /paretsky|warshawski/ },

  // ---- authors named without a specific title ----
  { title: "Karin Slaughter", author: "Karin Slaughter", kind: "author", re: /karin slaughter|karen slaughter|grant county|kisscut/ },
  { title: "P.D. James", author: "P.D. James", kind: "author", re: /p\.? ?d\.? ?james/ },
  { title: "Elizabeth George", author: "Elizabeth George", kind: "author", re: /elizabeth george/ },
  { title: "Louise Penny", author: "Louise Penny", kind: "author", re: /louise pen+y|gamache/ },
  { title: "Ruth Rendell", author: "Ruth Rendell", kind: "author", re: /rendell|barbara vine/ },
  { title: "Elmore Leonard", author: "Elmore Leonard", kind: "author", re: /elmore leonard|labrava|tishimingo|the hot kid/ },
  { title: "James Ellroy", author: "James Ellroy", kind: "author", re: /ellroy/ },
  { title: "Robert Crais", author: "Robert Crais", kind: "author", re: /crais/ },
  { title: "Karin Fossum", author: "Karin Fossum", kind: "author", re: /fossum/ },
  { title: "Camilla Läckberg", author: "Camilla Läckberg", kind: "author", re: /ckberg/ },
  { title: "George Pelecanos", author: "George Pelecanos", kind: "author", re: /pelecanos/ },
  { title: "Denise Mina", author: "Denise Mina", kind: "author", re: /denise mina|garnethill/ },
  { title: "Ann Cleeves", author: "Ann Cleeves", kind: "author", re: /cleeves/ },
  { title: "John Sandford", author: "John Sandford", kind: "author", re: /sandford|john sanford|winter prey/ },
  { title: "John Connolly", author: "John Connolly", kind: "author", re: /john connolly|john connelly/ },
  { title: "Carl Hiaasen", author: "Carl Hiaasen", kind: "author", re: /hiaasen|hiassen/ },
  { title: "Laura Lippman", author: "Laura Lippman", kind: "author", re: /lippman/ },
  { title: "Joyce Carol Oates", author: "Joyce Carol Oates", kind: "author", re: /joyce carol oates/ },
  { title: "Ian Rankin", author: "Ian Rankin", kind: "author", re: /rankin/ },
  { title: "Ragnar Jónasson", author: "Ragnar Jónasson", kind: "author", re: /ragnar|jonasson|johasson/ },
  { title: "Donna Leon", author: "Donna Leon", kind: "author", re: /donna leon/ },
  { title: "Peter James", author: "Peter James", kind: "author", re: /peter james|roy grace/ },
  { title: "Martin Cruz Smith", author: "Martin Cruz Smith", kind: "author", re: /martin cruz smith|gorky park/ },
  { title: "Patrick Radden Keefe", author: "Patrick Radden Keefe", kind: "author", re: /radden keefe/, display: "Patrick Radden Keefe books" },
  { title: "Michael Crichton", author: "Michael Crichton", kind: "author", re: /crichton|creighton|jurassic park|andromeda/ },
  { title: "Tom Clancy", author: "Tom Clancy", kind: "author", re: /clancy/ },
  { title: "Arturo Pérez-Reverte", author: "Arturo Pérez-Reverte", kind: "author", re: /reverte|flanders panel/ },

  // ---- books already in the library ----
  { title: "Drive Your Plow Over the Bones of the Dead", author: "Olga Tokarczuk", kind: "existing", re: /drive your plow|tokarczuk|takarczu/ },
  { title: "The Secret History", author: "Donna Tartt", kind: "existing", re: /secret history/ },
  { title: "The Stand", author: "Stephen King", kind: "existing", re: /\bthe stand\b/ },
  { title: "The Day of the Jackal", author: "Frederick Forsyth", kind: "existing", re: /day of the jack/ },
  { title: "Bernie Gunther series", author: "Philip Kerr", kind: "existing", re: /\bkerr\b|bernie gunther/ },
  { title: "The Shadow of the Wind", author: "Carlos Ruiz Zafón", kind: "existing", re: /zafon|shadow of the wind/ },
];

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const lines = readFileSync(join(root, "data", "raw", "nyt-thrillers-comments.txt"), "utf8").trim().split("\n");
const comments = lines.map((l) => {
  const [, name, ...rest] = l.split("|");
  return { name: name.trim(), text: norm(rest.join("|")) };
});

const verbose = process.argv.includes("--verbose");
// The saved file keeps counts only, not reader names, so it is safe to commit.
const rows: string[] = ["Title|Author|Kind|Readers"];
const dropped: string[] = [];

for (const spec of SPECS) {
  const readers = [...new Set(comments.filter((c) => spec.re.test(c.text)).map((c) => c.name))];
  const line = `${String(readers.length).padStart(2)}  ${spec.kind.padEnd(8)} ${spec.title}`;
  if (readers.length >= 2) {
    const shown = spec.display ?? (spec.kind === "author" ? `${spec.title} novels` : spec.title);
    rows.push([shown, spec.author, spec.kind, readers.length].join("|"));
    console.log(line + (verbose ? `\n      ${readers.join("; ")}` : ""));
  } else {
    dropped.push(line + (readers.length ? `  (${readers.join("; ")})` : ""));
  }
}

writeFileSync(join(root, "data", "raw", "nyt-reader-picks.psv"), rows.join("\n") + "\n");
console.log(`\nKept ${rows.length - 1} named by 2+ different readers. Dropped ${dropped.length}:`);
for (const d of dropped) console.log("  " + d);
