"use client";

import { Suspense, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { MOODS, STATUS_LABEL, type ReadingStatus, READING_STATUSES } from "@/domain/book";
import { facetCounts, filterBooks, listCounts, sortBooks } from "@/domain/bookActions";
import { useLibrary } from "@/hooks/useLibrary";
import { BookCard } from "@/components/books/BookCard";
import { EmptyState } from "@/components/shared/EmptyState";
import { LoadProblem } from "@/components/shared/LoadProblem";
import { ScenicBanner } from "@/components/shared/ScenicBanner";
import { SearchInput } from "@/components/shared/SearchInput";

export default function BrowsePage() {
  return (
    <Suspense fallback={null}>
      <BrowseView />
    </Suspense>
  );
}

function BrowseView() {
  const params = useSearchParams();
  const { books, ready, loadFailed } = useLibrary();

  // Filters start from the link (Home search, a list on Lists) and then live here.
  const [query, setQuery] = useState(params.get("q") ?? "");
  const [source, setSource] = useState(params.get("source") ?? "");
  const [genre, setGenre] = useState(params.get("genre") ?? "");
  const [mood, setMood] = useState(params.get("mood") ?? "");
  const [status, setStatus] = useState<ReadingStatus | "">("");
  const [favoritesOnly, setFavoritesOnly] = useState(false);

  const genres = useMemo(() => facetCounts(books, "genres"), [books]);
  const moods = useMemo(
    () => MOODS.filter((m) => facetCounts(books, "moods").some((f) => f.value === m)),
    [books],
  );
  const sources = useMemo(() => listCounts(books), [books]);

  const results = useMemo(
    () =>
      sortBooks(
        filterBooks(books, {
          query,
          source: source || undefined,
          genre: genre || undefined,
          mood: mood || undefined,
          status: status || undefined,
          favoritesOnly,
        }),
        "title",
      ),
    [books, query, source, genre, mood, status, favoritesOnly],
  );

  const anyFilter = Boolean(query || source || genre || mood || status || favoritesOnly);

  function clear() {
    setQuery("");
    setSource("");
    setGenre("");
    setMood("");
    setStatus("");
    setFavoritesOnly(false);
  }

  return (
    <>
      <ScenicBanner slot="browseBanner" title="Browse" />
      <div className="stack">
        <SearchInput
          key={`${params.get("q") ?? ""}`}
          initialValue={query}
          onChange={setQuery}
          onSubmit={setQuery}
        />

        <div className="chips" role="group" aria-label="Genre">
          <button type="button" className={`chip${genre === "" ? " is-on" : ""}`} aria-pressed={genre === ""} onClick={() => setGenre("")}>
            All
          </button>
          {genres.map((g) => (
            <button
              key={g.value}
              type="button"
              className={`chip${genre === g.value ? " is-on" : ""}`}
              aria-pressed={genre === g.value}
              onClick={() => setGenre(genre === g.value ? "" : g.value)}
            >
              {g.value}
            </button>
          ))}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <div className="field">
            <label htmlFor="f-source">List</label>
            <select id="f-source" className="select" value={source} onChange={(e) => setSource(e.target.value)}>
              <option value="">All lists</option>
              {sources.map((s) => (
                <option key={s.source} value={s.source}>
                  {s.source}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="f-mood">Mood</label>
            <select id="f-mood" className="select" value={mood} onChange={(e) => setMood(e.target.value)}>
              <option value="">Any mood</option>
              {moods.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="f-status">Status</label>
            <select id="f-status" className="select" value={status} onChange={(e) => setStatus(e.target.value as ReadingStatus | "")}>
              <option value="">Any status</option>
              {READING_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="f-fav">Favorites</label>
            <button
              id="f-fav"
              type="button"
              className={`chip${favoritesOnly ? " is-on" : ""}`}
              style={{ minHeight: 44 }}
              aria-pressed={favoritesOnly}
              onClick={() => setFavoritesOnly(!favoritesOnly)}
            >
              {favoritesOnly ? "Favorites only" : "All books"}
            </button>
          </div>
        </div>

        {!ready ? (
          <p className="muted">Loading your library…</p>
        ) : loadFailed ? (
          <LoadProblem />
        ) : results.length === 0 ? (
          <EmptyState
            title="No books match those filters"
            body="Try fewer filters or a different search."
            action={
              anyFilter ? (
                <button type="button" className="btn" onClick={clear}>
                  Clear filters
                </button>
              ) : undefined
            }
          />
        ) : (
          <>
            <p className="muted" aria-live="polite">
              {results.length} {results.length === 1 ? "book" : "books"}
              {anyFilter ? (
                <>
                  {" · "}
                  <button type="button" className="btn btn--small" onClick={clear}>
                    Clear
                  </button>
                </>
              ) : null}
            </p>
            <div className="grid">
              {results.map((b) => (
                <BookCard key={b.id} book={b} />
              ))}
            </div>
          </>
        )}
      </div>
    </>
  );
}
