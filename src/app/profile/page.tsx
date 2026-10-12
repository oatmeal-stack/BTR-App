"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { normalizeText } from "@/domain/bookActions";
import { useLibrary } from "@/hooks/useLibrary";
import { useIncludeRead } from "@/lib/prefs";
import { ROUTES } from "@/routes";
import { EmptyState } from "@/components/shared/EmptyState";
import { ScenicBanner } from "@/components/shared/ScenicBanner";
import { SearchInput } from "@/components/shared/SearchInput";
import { PasscodeSection } from "@/components/shared/PasscodeSection";
import { SkinSelector } from "@/components/theme/SkinSelector";

const when = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

export default function ProfilePage() {
  const { books, notes: allNotes, removedBooks, ready } = useLibrary();
  const [query, setQuery] = useState("");
  const [includeRead, setIncludeRead] = useIncludeRead();

  // Notes on a removed book come back with it, but aren't listed while it's removed.
  const notes = useMemo(() => {
    const hidden = new Set(removedBooks.map((b) => b.id));
    return allNotes.filter((n) => !hidden.has(n.bookId));
  }, [allNotes, removedBooks]);

  const rows = useMemo(() => {
    const words = normalizeText(query).split(" ").filter(Boolean);
    return notes
      .map((n) => ({ note: n, book: books.find((b) => b.id === n.bookId) }))
      .filter(({ note, book }) => {
        if (!words.length) return true;
        const hay = normalizeText(`${note.body} ${book?.title ?? ""}`);
        return words.every((w) => hay.includes(w));
      })
      .sort((a, b) => b.note.updatedAt.localeCompare(a.note.updatedAt));
  }, [notes, books, query]);

  return (
    <>
      <ScenicBanner slot="browseBanner" title="Profile" />
      <div className="stack">
        <section aria-labelledby="look-h" className="stack" style={{ padding: 0 }}>
          <h2 id="look-h" style={{ fontSize: 18 }}>
            Appearance
          </h2>
          <p className="muted" style={{ fontSize: 14 }}>
            Changes colors, fonts and pictures only. Your books and notes stay exactly as they are.
          </p>
          <SkinSelector />
        </section>

        <section aria-labelledby="picks-h" className="stack" style={{ padding: 0 }}>
          <h2 id="picks-h" style={{ fontSize: 18 }}>
            Random picks
          </h2>
          <label className="card" style={{ display: "flex", gap: 12, alignItems: "center", cursor: "pointer" }}>
            <input type="checkbox" checked={includeRead} onChange={(e) => setIncludeRead(e.target.checked)} style={{ width: 22, height: 22 }} />
            <span>
              Include books I&apos;ve read
              <span className="muted" style={{ display: "block", fontSize: 14 }}>
                Off: the book on the home screen and &ldquo;Pick one for me&rdquo; skip anything you&apos;ve read.
              </span>
            </span>
          </label>
        </section>

        <section aria-labelledby="notes-h" className="stack" style={{ padding: 0 }}>
          <h2 id="notes-h" style={{ fontSize: 18 }}>
            All notes ({notes.length})
          </h2>
          <SearchInput label="Search notes" placeholder="Search your notes" onChange={setQuery} onSubmit={setQuery} />
          {!ready ? (
            <p className="muted">Loading…</p>
          ) : rows.length === 0 ? (
            <EmptyState
              title={notes.length ? "No notes match" : "No notes yet"}
              body={notes.length ? "Try a different search." : "Open a book and add a private note."}
            />
          ) : (
            rows.map(({ note, book }) => (
              <div key={note.id} className="card notecard">
                <div className="notecard__meta">
                  {book ? <Link href={ROUTES.book(book.id)}>{book.title}</Link> : <span>Removed book</span>}
                  <span>{when(note.updatedAt)}</span>
                </div>
                <p style={{ whiteSpace: "pre-wrap" }}>{note.body}</p>
              </div>
            ))
          )}
        </section>

        <section aria-labelledby="removed-h" className="stack" style={{ padding: 0 }}>
          <h2 id="removed-h" style={{ fontSize: 18 }}>
            Removed books
          </h2>
          <p className="muted" style={{ fontSize: 14 }}>
            Books you&apos;ve removed are hidden, not deleted, and re-importing a list won&apos;t bring them back.
          </p>
          <Link className="btn" href={ROUTES.removed}>
            See removed books ({removedBooks.length})
          </Link>
        </section>

        <PasscodeSection />
      </div>
    </>
  );
}
