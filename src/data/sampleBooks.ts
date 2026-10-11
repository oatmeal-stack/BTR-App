import type { Book, ReadingStatus, SourceTag } from "@/domain/book";

/**
 * Development sample data: real titles from your five lists, so the app has
 * something to show before the Supabase import exists.
 * - Titles, authors, source tags and Man Book Club scores are from your lists.
 * - Genres and moods are PLACEHOLDERS until the Claude tagging pass runs.
 * - Cover art is left empty on purpose (tasteful placeholders, no fake covers).
 */

const M = "Man Book Club";
const T = "Tough Guy Book Club";
const F = "Fantasy Top 100 UK";
const S = "NYT Spy Novels";
const N = "NYT 50 Thrillers";

interface Seed {
  title: string;
  author: string;
  year: number;
  sources: SourceTag[];
  genres: string[];
  moods: string[];
  rating?: number;
  note?: string;
  status?: ReadingStatus;
  favorite?: boolean;
}

const SEEDS: Seed[] = [
  { title: "Lonesome Dove", author: "Larry McMurtry", year: 1985, sources: [{ source: M, rank: 152 }], genres: ["Western", "Historical"], moods: ["Epic", "Slow burn"], rating: 9.0, note: "Highest-rated book on their list", favorite: true },
  { title: "Demon Copperhead", author: "Barbara Kingsolver", year: 2022, sources: [{ source: M, rank: 145 }], genres: ["Literary"], moods: ["Epic", "Hopeful"], rating: 8.9, status: "reading" },
  { title: "Train Dreams", author: "Denis Johnson", year: 2011, sources: [{ source: M, rank: 158 }], genres: ["Literary", "Western"], moods: ["Quiet"], rating: 8.2 },
  { title: "Deacon King Kong", author: "James McBride", year: 2020, sources: [{ source: M, rank: 129 }], genres: ["Literary"], moods: ["Funny", "Hopeful"], rating: 8.5 },
  { title: "The Sympathizer", author: "Viet Thanh Nguyen", year: 2015, sources: [{ source: M, rank: 89 }, { source: S }], genres: ["Literary", "Spy"], moods: ["Dark"], rating: 8.2, favorite: true },
  { title: "Klara and the Sun", author: "Kazuo Ishiguro", year: 2021, sources: [{ source: M, rank: 143 }], genres: ["Sci-fi", "Literary"], moods: ["Quiet", "Hopeful"], rating: 8.0 },
  { title: "The Quiet American", author: "Graham Greene", year: 1955, sources: [{ source: M, rank: 68 }, { source: S }], genres: ["Spy", "Literary"], moods: ["Dark", "Quiet"], rating: 7.1 },
  { title: "Heart of Darkness", author: "Joseph Conrad", year: 1899, sources: [{ source: M, rank: 80 }], genres: ["Literary", "Adventure"], moods: ["Dark"], rating: 8.4 },
  { title: "The Wager", author: "David Grann", year: 2023, sources: [{ source: M, rank: 142 }], genres: ["Nonfiction", "Adventure"], moods: ["Tense"], rating: 8.0 },
  { title: "Project Hail Mary", author: "Andy Weir", year: 2021, sources: [{ source: M, rank: 131 }], genres: ["Sci-fi"], moods: ["Funny", "Hopeful"], rating: 6.4 },
  { title: "Last Orders", author: "Graham Swift", year: 1996, sources: [{ source: T }, { source: M, rank: 121 }], genres: ["Literary"], moods: ["Quiet"], rating: 8.0 },
  { title: "The Long Way to a Small, Angry Planet", author: "Becky Chambers", year: 2014, sources: [{ source: T }, { source: F }], genres: ["Sci-fi"], moods: ["Cozy", "Hopeful"], note: "Read by Tough Guy Book Club, Sept 2025" },
  { title: "The Road", author: "Cormac McCarthy", year: 2006, sources: [{ source: T }], genres: ["Literary"], moods: ["Dark", "Quiet"], status: "read" },
  { title: "Station Eleven", author: "Emily St. John Mandel", year: 2014, sources: [{ source: T }], genres: ["Sci-fi", "Literary"], moods: ["Hopeful", "Quiet"], status: "read" },
  { title: "The Pearl", author: "John Steinbeck", year: 1947, sources: [{ source: T }], genres: ["Literary"], moods: ["Quiet"], note: "TGBC Camp book 2026" },
  { title: "World War Z", author: "Max Brooks", year: 2006, sources: [{ source: T }], genres: ["Horror", "Sci-fi"], moods: ["Tense"] },
  { title: "A Wizard of Earthsea", author: "Ursula K. Le Guin", year: 1968, sources: [{ source: T }], genres: ["Fantasy"], moods: ["Quiet", "Epic"], note: "TGBC Camp book" },
  { title: "The Lord of the Rings", author: "J.R.R. Tolkien", year: 1954, sources: [{ source: F, rank: 1 }, { source: T }], genres: ["Fantasy"], moods: ["Epic"], note: "Long read" },
  { title: "Dune", author: "Frank Herbert", year: 1965, sources: [{ source: F, rank: 77 }], genres: ["Sci-fi", "Fantasy"], moods: ["Epic"] },
  { title: "The Name of the Wind", author: "Patrick Rothfuss", year: 2007, sources: [{ source: F, rank: 3 }], genres: ["Fantasy"], moods: ["Epic", "Slow burn"] },
  { title: "Good Omens", author: "Terry Pratchett and Neil Gaiman", year: 1990, sources: [{ source: F, rank: 20 }], genres: ["Fantasy", "Humor"], moods: ["Funny"] },
  { title: "The Princess Bride", author: "William Goldman", year: 1973, sources: [{ source: F, rank: 29 }], genres: ["Fantasy", "Adventure"], moods: ["Funny", "Cozy"] },
  { title: "Slow Horses", author: "Mick Herron", year: 2010, sources: [{ source: S }, { source: N, rank: 9 }], genres: ["Spy", "Thriller"], moods: ["Tense", "Funny"] },
  { title: "Gone Girl", author: "Gillian Flynn", year: 2012, sources: [{ source: N, rank: 1 }], genres: ["Thriller", "Mystery"], moods: ["Tense", "Dark"] },
  { title: "Mystic River", author: "Dennis Lehane", year: 2001, sources: [{ source: N, rank: 2 }], genres: ["Mystery", "Thriller"], moods: ["Dark"] },
  { title: "No Country for Old Men", author: "Cormac McCarthy", year: 2005, sources: [{ source: N, rank: 5 }], genres: ["Thriller", "Western"], moods: ["Dark", "Tense"] },
  { title: "The Hunt for Red October", author: "Tom Clancy", year: 1984, sources: [{ source: S }], genres: ["Spy", "Thriller"], moods: ["Tense"] },
  { title: "Red Sparrow", author: "Jason Matthews", year: 2013, sources: [{ source: S }], genres: ["Spy", "Thriller"], moods: ["Tense", "Dark"] },
  { title: "The Day of the Jackal", author: "Frederick Forsyth", year: 1971, sources: [{ source: S }], genres: ["Spy", "Thriller"], moods: ["Tense"] },
  { title: "Tinker Tailor Soldier Spy", author: "John le Carré", year: 1974, sources: [{ source: S }], genres: ["Spy"], moods: ["Slow burn", "Dark"] },
];

export function slugify(title: string, author?: string): string {
  const base = `${title} ${author ?? ""}`
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `bk-${base}`;
}

const DAY = 24 * 60 * 60 * 1000;
const BASE_TIME = Date.parse("2026-08-09T12:00:00.000Z");

export const SAMPLE_BOOKS: Book[] = SEEDS.map((s, i) => {
  const stamp = new Date(BASE_TIME - i * DAY).toISOString();
  return {
    id: slugify(s.title, s.author),
    title: s.title,
    author: s.author,
    year: s.year,
    status: s.status ?? "want_to_read",
    rating: s.rating,
    sourceNote: s.note,
    favorite: s.favorite ?? false,
    genres: s.genres,
    moods: s.moods,
    sources: s.sources,
    createdAt: stamp,
    updatedAt: stamp,
  };
});
