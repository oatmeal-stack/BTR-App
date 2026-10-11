"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import type { Book } from "@/domain/book";
import { useLibrary } from "@/hooks/useLibrary";
import { ROUTES } from "@/routes";
import { ScenicBanner } from "@/components/shared/ScenicBanner";

export default function AddPage() {
  const { addBook, restoreBook, requiresPasscode, unlocked, ready } = useLibrary();
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ book: Book; created: boolean } | null>(null);
  const [restored, setRestored] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) {
      setError("Enter a title first.");
      return;
    }
    setError("");
    setBusy(true);
    const result = await addBook({ title, author, note });
    setBusy(false);
    if (!result) return;
    setDone(result);
    setRestored(false);
    setTitle("");
    setAuthor("");
    setNote("");
  }

  return (
    <>
      <ScenicBanner slot="browseBanner" title="Add a book" subtitle="Quick add: just the basics." />
      <div className="stack">
        <Link className="back" href={ROUTES.home}>
          <ArrowLeft size={16} aria-hidden="true" /> Home
        </Link>

        {ready && requiresPasscode && !unlocked ? (
          <p className="card" role="status">
            Adding books needs your passcode. <Link href={ROUTES.profile}>Enter it in Profile</Link> first.
          </p>
        ) : null}

        <form className="stack" style={{ padding: 0 }} onSubmit={submit} noValidate>
          <div className="field">
            <label htmlFor="add-title">Title</label>
            <input
              id="add-title"
              className="input"
              value={title}
              autoComplete="off"
              onChange={(e) => {
                setTitle(e.target.value);
                setError("");
              }}
            />
          </div>
          <div className="field">
            <label htmlFor="add-author">Author (optional)</label>
            <input id="add-author" className="input" value={author} autoComplete="off" onChange={(e) => setAuthor(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="add-note">Note (optional)</label>
            <input
              id="add-note"
              className="input"
              value={note}
              placeholder="Who mentioned it, or where you saw it"
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
          {error ? <p className="error">{error}</p> : null}
          <button type="submit" className="btn btn--primary btn--block" disabled={busy}>
            {busy ? "Adding…" : "Add book"}
          </button>
        </form>

        {done?.book.removedAt && !restored ? (
          <div className="card" role="status">
            <p>
              You removed <strong>{done.book.title}</strong> earlier, so it wasn&apos;t added again. Bring it back?
            </p>
            <button
              type="button"
              className="btn btn--primary"
              style={{ marginTop: 10 }}
              onClick={async () => {
                if (await restoreBook(done.book.id)) setRestored(true);
              }}
            >
              Restore it
            </button>
          </div>
        ) : done ? (
          <p className="card" role="status">
            {done.created ? (
              <>Added <strong>{done.book.title}</strong> to your library. </>
            ) : (
              <><strong>{done.book.title}</strong> is already in your library, so nothing was duplicated. </>
            )}
            <Link href={ROUTES.book(done.book.id)}>Open it</Link>
          </p>
        ) : null}

        <section className="card" style={{ fontSize: 14 }}>
          <h2 style={{ fontSize: 18, marginBottom: 6 }}>Bulk add</h2>
          <p className="muted">
            Pasting a list or a link and having Claude pull out the books comes with the shared
            database setup. Quick add works now.
          </p>
        </section>
      </div>
    </>
  );
}
