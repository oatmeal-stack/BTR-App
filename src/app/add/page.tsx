"use client";

import { Suspense, useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import type { Book } from "@/domain/book";
import { guessBookFromNote } from "@/domain/listActions";
import { useLibrary } from "@/hooks/useLibrary";
import { ROUTES } from "@/routes";
import { BookCover } from "@/components/books/BookCover";
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
  const { addBook, restoreBook, requiresPasscode, unlocked, ready, lists, addToList, drafts, setDraftStatus, lookupAmazon } = useLibrary();
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [note, setNote] = useState("");
  const [chosen, setChosen] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ book: Book; created: boolean } | null>(null);
  const [restored, setRestored] = useState(false);

  // From an Amazon link: what was found fills the form for you to check; nothing is saved until Add.
  const [link, setLink] = useState("");
  const [looking, setLooking] = useState(false);
  const [amazonMsg, setAmazonMsg] = useState("");
  const [pages, setPages] = useState("");
  const [cover, setCover] = useState("");
  const [asin, setAsin] = useState("");
  const [fullTitle, setFullTitle] = useState("");

  async function fromAmazon() {
    if (!link.trim()) return;
    setLooking(true);
    setAmazonMsg("");
    const r = await lookupAmazon(link);
    setLooking(false);
    if (!r.ok) {
      setAmazonMsg(
        r.reason === "short-needs-signin"
          ? "Short Amazon share links need your passcode (Profile). Or paste the full link, or the ISBN."
          : r.reason === "not-found"
            ? "I couldn't find that book from the link. You can type the title instead."
            : "I couldn't read that. Paste an Amazon book link or an ISBN.",
      );
      return;
    }
    const b = r.book;
    setTitle(b.title);
    setAuthor(b.author ?? "");
    setPages(b.pages ? String(b.pages) : "");
    setCover(b.coverUrl ?? "");
    setAsin(b.asin ?? "");
    setFullTitle(b.fullTitle ?? "");
    setError("");
    const found = [b.pages ? `${b.pages} pages` : null, b.coverUrl ? "a cover" : null].filter(Boolean);
    setAmazonMsg(`Found ${b.title}${b.author ? ` by ${b.author}` : ""}${found.length ? ` (${found.join(", ")})` : ""}. Check it, then Add.`);
  }

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
    const pageNumber = Number(pages.trim());
    const result = await addBook({
      title,
      author,
      note,
      pageCount: pages.trim() && Number.isInteger(pageNumber) && pageNumber > 0 ? pageNumber : undefined,
      coverUrl: cover.trim() || undefined,
      asin: asin || undefined,
    });
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
    setLink("");
    setPages("");
    setCover("");
    setAsin("");
    setFullTitle("");
    setAmazonMsg("");
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

        <section className="card stack" style={{ gap: 10 }} aria-labelledby="amazon-h">
          <h2 id="amazon-h" style={{ fontSize: 18 }}>
            From an Amazon link
          </h2>
          <p className="muted" style={{ fontSize: 14 }}>
            Paste a link from Amazon (the Share button works), or an ISBN, and the title, author, pages and cover fill in below.
          </p>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              aria-label="Amazon link"
              className="input"
              value={link}
              autoComplete="off"
              inputMode="url"
              placeholder="https://a.co/d/… or amazon.com/dp/…"
              onChange={(e) => {
                setLink(e.target.value);
                setAmazonMsg("");
              }}
            />
            <button type="button" className="btn" style={{ whiteSpace: "nowrap", flexShrink: 0 }} disabled={looking || !link.trim()} onClick={() => void fromAmazon()}>
              {looking ? "Reading…" : "Fill in"}
            </button>
          </div>
          {amazonMsg ? (
            <p className="muted" role="status" style={{ fontSize: 14 }}>
              {amazonMsg}
            </p>
          ) : null}
        </section>

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
          {fullTitle ? (
            <p className="muted" style={{ fontSize: 14 }}>
              Amazon calls it &ldquo;{fullTitle}&rdquo;.{" "}
              <button type="button" className="btn btn--small" onClick={() => setTitle(fullTitle)}>
                Use the full title
              </button>
            </p>
          ) : null}
          <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
            <div className="field" style={{ flex: 1 }}>
              <label htmlFor="add-pages">Pages (optional)</label>
              <input id="add-pages" className="input" inputMode="numeric" value={pages} autoComplete="off" onChange={(e) => setPages(e.target.value)} />
            </div>
            {cover ? (
              <div style={{ width: 64, flexShrink: 0 }} aria-label="Cover found">
                <BookCover book={{ title: title || "Cover", coverUrl: cover }} decorative />
              </div>
            ) : null}
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
