"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, Shuffle } from "lucide-react";
import type { Book } from "@/domain/book";
import { sortBooks } from "@/domain/bookActions";
import { useLibrary } from "@/hooks/useLibrary";
import { ROUTES } from "@/routes";
import { BookCard } from "@/components/books/BookCard";
import { BookCover } from "@/components/books/BookCover";
import { BookRow } from "@/components/books/BookRow";
import { EmptyState } from "@/components/shared/EmptyState";
import { LoadProblem } from "@/components/shared/LoadProblem";
import { ScenicBanner } from "@/components/shared/ScenicBanner";
import { SearchInput } from "@/components/shared/SearchInput";

export default function HomePage() {
  const router = useRouter();
  const { books, ready, loadFailed, home, shuffle } = useLibrary();

  const pick = books.find((b) => b.id === home.pickId);
  const forYou = home.forYouIds
    .map((id) => books.find((b) => b.id === id))
    .filter((b): b is Book => Boolean(b));
  const reading = books.filter((b) => b.status === "reading");
  const recent = sortBooks(books, "recent").slice(0, 5);

  return (
    <>
      <ScenicBanner
        slot="pickHero"
        title="Your next read"
        subtitle="Discover your next great read."
        action={
          <Link className="iconbtn" href={ROUTES.add} aria-label="Add books">
            <Plus size={20} aria-hidden="true" />
          </Link>
        }
      />
      <div className="stack">
        <SearchInput
          placeholder="Search books or authors"
          onSubmit={(q) => router.push(ROUTES.browseWith({ q }))}
        />

        {!ready ? (
          <p className="muted">Loading your library…</p>
        ) : loadFailed ? (
          <LoadProblem />
        ) : !pick ? (
          <EmptyState
            title="Your library is empty"
            body="Add a book to get started."
            action={
              <Link className="btn btn--primary" href={ROUTES.add}>
                Add a book
              </Link>
            }
          />
        ) : (
          <section className="card" aria-label="Random pick">
            <div className="pick">
              <div className="pick__cover">
                <BookCover book={pick} large />
              </div>
              <div className="pick__body">
                <h2>{pick.title}</h2>
                {pick.author ? <p className="muted">{pick.author}</p> : null}
                <p style={{ marginTop: 8 }}>
                  {pick.sources.map((s) => (
                    <span key={s.source} className="tag">
                      {s.source}
                    </span>
                  ))}
                </p>
              </div>
            </div>
            <div className="pick__actions">
              <button type="button" className="btn" onClick={shuffle}>
                <Shuffle size={18} aria-hidden="true" /> Shuffle
              </button>
              <Link className="btn btn--primary" href={ROUTES.book(pick.id)}>
                Open book
              </Link>
            </div>
          </section>
        )}

        {reading.length > 0 && (
          <section aria-labelledby="reading-h">
            <div className="section-head">
              <h2 id="reading-h">Currently reading</h2>
            </div>
            <ul className="rows">
              {reading.map((b) => (
                <BookRow key={b.id} book={b} />
              ))}
            </ul>
          </section>
        )}

        {forYou.length > 0 && (
          <section aria-labelledby="foryou-h">
            <div className="section-head">
              <h2 id="foryou-h">For you</h2>
              <Link href={ROUTES.library}>See library</Link>
            </div>
            <div className="hrow" style={{ marginTop: 12 }}>
              {forYou.map((b) => (
                <BookCard key={b.id} book={b} />
              ))}
            </div>
            <p className="muted" style={{ fontSize: 13 }}>
              Random picks from your Want to read.
            </p>
          </section>
        )}

        {recent.length > 0 && (
          <section aria-labelledby="recent-h">
            <div className="section-head">
              <h2 id="recent-h">Recently added</h2>
              <Link href={ROUTES.browse}>See all</Link>
            </div>
            <ul className="rows">
              {recent.map((b) => (
                <BookRow key={b.id} book={b} />
              ))}
            </ul>
          </section>
        )}
      </div>
    </>
  );
}
