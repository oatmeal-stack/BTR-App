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
  /** Year first published (not a date: sources only give the year). */
  year?: number;
  pageCount?: number;
  status: ReadingStatus;
  /** Amazon's product id, when the book was added from an Amazon link. Lets the Amazon button go straight to the book. */
  asin?: string;
  /** The day you pressed Start on it (YYYY-MM-DD). Only the Start button sets this. */
  startedOn?: string;
  /** When you finished it (YYYY-MM-DD), if you said. */
  finishedOn?: string;
  /** Your own rating, 1 to 5 stars. Not the Man Book Club score (that is `rating`). */
  myRating?: number;
  /** Only Man Book Club rows have a score (out of 10). Never invented. */
  rating?: number;
  coverUrl?: string;
  /**
   * Set when the book has been removed. A removed book is hidden everywhere (browse, search, the
   * random pick, every list) but is never deleted, so it can be restored with everything intact.
   */
  removedAt?: string;
  /** Short note that came with the book (imported, or typed at quick add). */
  sourceNote?: string;
  favorite: boolean;
  genres: string[];
  moods: string[];
  sources: SourceTag[];
  createdAt: string;
  updatedAt: string;
}

/**
 * Everything the Edit screen can change, all at once (the form always holds the full set, so saving
 * replaces these fields rather than patching some of them). Blank fields clear the value.
 */
export interface BookEdit {
  title: string;
  author?: string;
  year?: number;
  pageCount?: number;
  coverUrl?: string;
  genres: string[];
  moods: string[];
  /** The imported note that came with the book ("Notes" on the book page). */
  sourceNote?: string;
  /** List names. A list the book was already on keeps its rank. */
  sources: string[];
}

/** One of your own lists ("Couples book club"...). Private, like notes. A book can be on any number of them. */
export interface MyList {
  id: string;
  name: string;
  /** Order of the lists themselves. */
  position: number;
  createdAt: string;
}

/** A book on one of your lists; `position` is its place in that list's order (a list can be a queue). */
export interface ListItem {
  listId: string;
  bookId: string;
  position: number;
}

export type InboxStatus = "new" | "added" | "dismissed";

/** A rough note about a book to add later ("that spy novel about Berlin Mark mentioned"). The text is never edited. */
export interface InboxNote {
  id: string;
  body: string;
  status: InboxStatus;
  /** The book it became, once it was added. */
  bookId?: string;
  createdAt: string;
}

/** Private notes. Many per book. */
export interface BookNote {
  id: string;
  bookId: string;
  body: string;
  /** The chapter (or part, or page) the note is about, if you said. */
  chapter?: string;
  createdAt: string;
  updatedAt: string;
}

/** A place in the Next books queue. `position` 0 is first. */
export interface NextItem {
  bookId: string;
  position: number;
}

/** "My Take": the short verdict written when a book is finished. One per book, private. */
export interface BookTake {
  bookId: string;
  body: string;
  updatedAt: string;
}

/** What the Already Read import changes on one book. Anything left out is left as it was. */
export interface ReadRow {
  id: string;
  myRating?: number;
  finishedOn?: string;
  /** True to heart it; never used to un-heart. */
  favorite?: boolean;
  /** A private note to add (once), with the id it will have. */
  note?: string;
  noteId?: string;
  /** Bring the book back if it was removed. */
  restore?: boolean;
}

export interface NewBookInput {
  title: string;
  author?: string;
  year?: number;
  pageCount?: number;
  coverUrl?: string;
  asin?: string;
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
