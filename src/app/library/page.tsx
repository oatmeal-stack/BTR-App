"use client";

import { useMemo, useState } from "react";
import { READING_STATUSES, STATUS_LABEL, type ReadingStatus } from "@/domain/book";
import { filterBooks, sortBooks, type BookSort } from "@/domain/bookActions";
import { useLibrary } from "@/hooks/useLibrary";
import { ROUTES } from "@/routes";
import Link from "next/link";
import { Plus } from "lucide-react";
import { BookRow } from "@/components/books/BookRow";
import { EmptyState } from "@/components/shared/EmptyState";
import { LoadProblem } from "@/components/shared/LoadProblem";
import { ScenicBanner } from "@/components/shared/ScenicBanner";

type Tab = "all" | "favorites" | ReadingStatus;

export default function LibraryPage() {
  const { books, ready, loadFailed } = useLibrary();
  const [tab, setTab] = useState<Tab>("all");
  const [sort, setSort] = useState<BookSort>("recent");

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: books.length, favorites: 0 };
    for (const b of books) {
      c[b.status] = (c[b.status] ?? 0) + 1;
      if (b.favorite) c.favorites += 1;
    }
    return c;
  }, [books]);

  const shown = useMemo(() => {
    const filtered =
      tab === "all"
        ? books
        : tab === "favorites"
          ? filterBooks(books, { favoritesOnly: true })
          : filterBooks(books, { status: tab });
    return sortBooks(filtered, sort);
  }, [books, tab, sort]);

  const tabs: { key: Tab; label: string }[] = [
    { key: "all", label: "All" },
    ...READING_STATUSES.map((s) => ({ key: s as Tab, label: STATUS_LABEL[s] })),
    { key: "favorites", label: "Favorites" },
  ];

  return (
    <>
      <ScenicBanner
        slot="browseBanner"
        title="My library"
        action={
          <Link className="iconbtn" href={ROUTES.add} aria-label="Add books">
            <Plus size={20} aria-hidden="true" />
          </Link>
        }
      />
      <div className="stack">
        <div className="chips" role="group" aria-label="Filter by status">
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              className={`chip${tab === t.key ? " is-on" : ""}`}
              aria-pressed={tab === t.key}
              onClick={() => setTab(t.key)}
            >
              {t.label} ({counts[t.key] ?? 0})
            </button>
          ))}
        </div>

        <div className="field">
          <label htmlFor="sort">Sort by</label>
          <select id="sort" className="select" value={sort} onChange={(e) => setSort(e.target.value as BookSort)}>
            <option value="recent">Recently added</option>
            <option value="title">Title</option>
            <option value="author">Author</option>
          </select>
        </div>

        {!ready ? (
          <p className="muted">Loading your library…</p>
        ) : loadFailed ? (
          <LoadProblem />
        ) : shown.length === 0 ? (
          <EmptyState
            title="Nothing here yet"
            body={
              tab === "favorites"
                ? "Tap the heart on a book to keep it here."
                : "No books have this status. Change a book's status from its page."
            }
          />
        ) : (
          <ul className="rows">
            {shown.map((b) => (
              <BookRow key={b.id} book={b} />
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
