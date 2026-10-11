"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { normalizeText } from "@/domain/bookActions";
import { useLibrary } from "@/hooks/useLibrary";
import { ROUTES } from "@/routes";
import { EmptyState } from "@/components/shared/EmptyState";
import { ScenicBanner } from "@/components/shared/ScenicBanner";
import { SearchInput } from "@/components/shared/SearchInput";
import { PasscodeSection } from "@/components/shared/PasscodeSection";
import { SkinSelector } from "@/components/theme/SkinSelector";

const when = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

export default function ProfilePage() {
  const { books, notes, ready } = useLibrary();
  const [query, setQuery] = useState("");

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

        <PasscodeSection />
      </div>
    </>
  );
}
