"use client";

import { Suspense, useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import type { Book } from "@/domain/book";
import { guessBookFromNote } from "@/domain/listActions";
import { useLibrary } from "@/hooks/useLibrary";
import { ROUTES } from "@/routes";
import { ScenicBanner } from "@/components/shared/ScenicBanner";

export default function AddPage() {
  return (
    <Suspense fallback={null}>
      <AddView />
    </Suspense>
  );
}

function AddView() {
  const draftId = useSearchParams().get("draft");
  const { addBook, restoreBook, requiresPasscode, unlocked, ready, lists, addToList, drafts, setDraftStatus } = useLibrary();
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [note, setNote] = useState("");
  const [chosen, setChosen] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ book: Book; created: boolean } | null>(null);
  const [restored, setRestored] = useState(false);

  // Coming from a draft: its text stays visible, and a title and author are guessed for you to correct.
  const draft = draftId ? drafts.find((d) => d.id === draftId) : undefined;
  const filledFrom = useRef<string | null>(null);
  useEffect(() => {
    if (!draft || filledFrom.current === draft.id) return;
    filledFrom.current = draft.id;
    const guess = guessBookFromNote(draft.body);
    setTitle(guess.title);
    setAuthor(guess.author);
  }, [draft]);

  const canUseLists = lists.length > 0 && (!requiresPasscode || unlocked);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) {
      setError("Enter a title first.");
      return;
    }
    setError("");
    setBusy(true);
    const result = await addBook({ title, author, note });
    if (result) {
      for (const listId of chosen) await addToList(listId, result.book.id);
      if (draft && !result.book.removedAt) await setDraftStatus(draft.id, "added", result.book.id);
    }
    setBusy(false);
    if (!result) return;
    setDone(result);
    setRestored(false);
    setTitle("");
    setAuthor("");
    setNote("");
    setChosen([]);
  }

  return (
    <>
      <ScenicBanner slot="browseBanner" title="Add a book" subtitle="Quick add: just the basics." />
      <div className="stack">
        <Link className="back" href={draft ? ROUTES.drafts : ROUTES.home}>
          <ArrowLeft size={16} aria-hidden="true" /> {draft ? "Drafts" : "Home"}
        </Link>

        {ready && requiresPasscode && !unlocked ? (
          <p className="card" role="status">
            Adding books needs your passcode. <Link href={ROUTES.profile}>Enter it in Profile</Link> first.
          </p>
        ) : null}

        {draft ? (
          <section className="card" aria-label="Your draft">
            <p className="muted" style={{ fontSize: 14, marginBottom: 6 }}>
              From your draft
            </p>
            <p style={{ whiteSpace: "pre-wrap" }}>{draft.body}</p>
          </section>
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
          {canUseLists ? (
            <fieldset className="field" style={{ border: 0, padding: 0 }}>
              <legend className="muted" style={{ marginBottom: 8 }}>
                Put it on a list (optional)
              </legend>
              <div className="statusbar">
                {lists.map((l) => (
                  <button
                    key={l.id}
                    type="button"
                    className={`chip${chosen.includes(l.id) ? " is-on" : ""}`}
                    aria-pressed={chosen.includes(l.id)}
                    onClick={() => setChosen(chosen.includes(l.id) ? chosen.filter((x) => x !== l.id) : [...chosen, l.id])}
                  >
                    {l.name}
                  </button>
                ))}
              </div>
            </fieldset>
          ) : null}
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
