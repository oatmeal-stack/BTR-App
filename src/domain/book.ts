export type ReadingStatus = "want_to_read" | "reading" | "read" | "abandoned";

export const READING_STATUSES: ReadingStatus[] = [
  "want_to_read",
  "reading",
  "read",
  "abandoned",
];

export const STATUS_LABEL: Record<ReadingStatus, string> = {
  want_to_read: "Want to read",
  reading: "Reading",
  read: "Read",
  abandoned: "Abandoned",
};

export interface SourceTag {
  source: string;
  rank?: number;
}

export interface Book {
  id: string;
  title: string;
  author?: string;
  year?: number;
  status: ReadingStatus;
  /** Only Man Book Club rows have a score (out of 10). Never invented. */
  rating?: number;
  coverUrl?: string;
  /** Short note that came with the book (imported, or typed at quick add). */
  sourceNote?: string;
  favorite: boolean;
  genres: string[];
  moods: string[];
  sources: SourceTag[];
  createdAt: string;
  updatedAt: string;
}

/** Private notes. Many per book. */
export interface BookNote {
  id: string;
  bookId: string;
  body: string;
  createdAt: string;
  updatedAt: string;
}

export interface NewBookInput {
  title: string;
  author?: string;
  year?: number;
  note?: string;
  sources?: SourceTag[];
}

export const SOURCE_LISTS = [
  "Man Book Club",
  "Tough Guy Book Club",
  "Fantasy Top 100 UK",
  "NYT Spy Novels",
  "NYT 50 Thrillers",
] as const;

/** Source given to books added by hand. */
export const MY_ADDITIONS = "My additions";

/** Fixed vocabulary so the genre/mood tagging pass stays consistent. */
export const GENRES = [
  "Literary",
  "Historical",
  "Western",
  "Thriller",
  "Spy",
  "Mystery",
  "Sci-fi",
  "Fantasy",
  "Horror",
  "Nonfiction",
  "Adventure",
  "Humor",
] as const;

export const MOODS = [
  "Epic",
  "Slow burn",
  "Tense",
  "Funny",
  "Cozy",
  "Hopeful",
  "Dark",
  "Quiet",
] as const;
