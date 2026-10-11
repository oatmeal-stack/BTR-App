"use client";

import { Suspense, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Search } from "lucide-react";
import { GENRES, MOODS, MY_ADDITIONS, SOURCE_LISTS, type Book, type BookEdit } from "@/domain/book";
import { editFromBook, findDuplicate } from "@/domain/bookActions";
import { useLibrary } from "@/hooks/useLibrary";
import { lookupDetails } from "@/lib/openLibrary";
import { ROUTES } from "@/routes";
import { BookCover } from "@/components/books/BookCover";
import { EmptyState } from "@/components/shared/EmptyState";

export default function EditPage() {
  return (
    <Suspense fallback={null}>
      <EditView />
    </Suspense>
  );
}

function EditView() {
  const id = useSearchParams().get("id");
  const { findBook, ready } = useLibrary();
  const book = id ? findBook(id) : undefined;

  if (!ready) {
    return (
      <div className="stack">
        <p className="muted">Loading…</p>
      </div>
    );
  }
  if (!book || book.removedAt) {
    return (
      <div className="stack">
        <Link className="back" href={ROUTES.browse}>
          <ArrowLeft size={16} aria-hidden="true" /> Browse
        </Link>
        <EmptyState
          title={book ? "This book was removed" : "Book not found"}
          body={book ? "Restore it first, then you can edit it." : "That book isn't in your library."}
          action={
            <Link className="btn btn--primary" href={book ? ROUTES.book(book.id) : ROUTES.browse}>
              {book ? "Open it" : "Browse books"}
            </Link>
          }
        />
      </div>
    );
  }
  return <EditForm book={book} />;
}

const toNumber = (s: string): number | undefined => {
  const n = Number(s.trim());
  return s.trim() && Number.isFinite(n) && n > 0 ? Math.round(n) : undefined;
};

function EditForm({ book }: { book: Book }) {
  const router = useRouter();
  const { books, updateBook, mergeBooks, requiresPasscode, unlocked } = useLibrary();
  const start = editFromBook(book);

  const [title, setTitle] = useState(start.title);
  const [author, setAuthor] = useState(start.author ?? "");
  const [year, setYear] = useState(start.year ? String(start.year) : "");
  const [pages, setPages] = useState(start.pageCount ? String(start.pageCount) : "");
  const [cover, setCover] = useState(start.coverUrl ?? "");
  const [genres, setGenres] = useState(start.genres);
  const [moods, setMoods] = useState(start.moods);
  const [sources, setSources] = useState(start.sources);
  const [extraLists, setExtraLists] = useState<string[]>([]);
  const [newList, setNewList] = useState("");
  const [note, setNote] = useState(start.sourceNote ?? "");
  const [error, setError] = useState("");
  const [lookupMsg, setLookupMsg] = useState("");
  const [looking, setLooking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [duplicate, setDuplicate] = useState<Book | null>(null);

  const toggle = (list: string[], set: (v: string[]) => void, value: string) =>
    set(list.includes(value) ? list.filter((x) => x !== value) : [...list, value]);

  const listChoices = [...new Set([...SOURCE_LISTS, MY_ADDITIONS, ...start.sources, ...extraLists, ...sources])] as string[];

  function readForm(): BookEdit | null {
    if (!title.trim()) {
      setError("A book needs a title.");
      return null;
    }
    if (year.trim() && !toNumber(year)) {
      setError("The year should be a number, like 1965.");
      return null;
    }
    if (pages.trim() && !toNumber(pages)) {
      setError("Pages should be a number, like 412.");
      return null;
    }
    if (sources.length === 0) {
      setError("Pick at least one list for this book.");
      return null;
    }
    setError("");
    return {
      title,
      author,
      year: toNumber(year),
      pageCount: toNumber(pages),
      coverUrl: cover,
      genres,
      moods,
      sourceNote: note,
      sources,
    };
  }

  async function save(force = false) {
    const edit = readForm();
    if (!edit) return;
    const dup = force ? undefined : findDuplicate(books, book.id, edit);
    if (dup) {
      setDuplicate(dup);
      return;
    }
    setBusy(true);
    const ok = await updateBook(book.id, edit);
    setBusy(false);
    if (ok) router.replace(ROUTES.book(book.id));
  }

  async function merge(into: Book) {
    setBusy(true);
    const ok = await mergeBooks(into.id, book.id);
    setBusy(false);
    if (ok) router.replace(ROUTES.book(into.id));
  }

  async function refresh() {
    if (!title.trim()) {
      setLookupMsg("Enter a title first.");
      return;
    }
    setLooking(true);
    setLookupMsg("");
    const found = await lookupDetails(title.trim(), author.trim() || undefined);
    setLooking(false);
    if (!found) {
      setLookupMsg("Couldn't find a confident match for that title and author. You can paste a cover address instead.");
      return;
    }
    const got: string[] = [];
    if (found.coverUrl) {
      setCover(found.coverUrl);
      got.push("cover");
    }
    // Year and pages only fill a blank: Open Library's year is wrong for roughly 1 book in 5, so it never
    // replaces one you already have. It says what it saw instead.
    const kept: string[] = [];
    if (found.year) {
      if (year.trim()) {
        if (String(found.year) !== year.trim()) kept.push(`Open Library says published ${found.year}`);
      } else {
        setYear(String(found.year));
        got.push(`published ${found.year}`);
      }
    }
    if (found.pageCount) {
      if (pages.trim()) {
        if (String(found.pageCount) !== pages.trim()) kept.push(`Open Library says ${found.pageCount} pages`);
      } else {
        setPages(String(found.pageCount));
        got.push(`${found.pageCount} pages`);
      }
    }
    const filled = got.length ? `Found: ${got.join(", ")}. Review it, then Save.` : "Found the book, but nothing new to fill in.";
    setLookupMsg(kept.length ? `${filled} Kept what you had (${kept.join("; ")}).` : filled);
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void save();
  }

  return (
    <div className="stack">
      <Link className="back" href={ROUTES.book(book.id)}>
        <ArrowLeft size={16} aria-hidden="true" /> Back to the book
      </Link>
      <h1>Edit book</h1>

      {requiresPasscode && !unlocked ? (
        <p className="card" role="status">
          Saving changes needs your passcode. <Link href={ROUTES.profile}>Enter it in Profile</Link> first.
        </p>
      ) : null}

      <form className="stack" style={{ padding: 0 }} onSubmit={onSubmit} noValidate>
        <div className="field">
          <label htmlFor="edit-title">Title</label>
          <input id="edit-title" className="input" value={title} autoComplete="off" onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="edit-author">Author</label>
          <input id="edit-author" className="input" value={author} autoComplete="off" onChange={(e) => setAuthor(e.target.value)} />
        </div>
        <div style={{ display: "flex", gap: 12 }}>
          <div className="field" style={{ flex: 1 }}>
            <label htmlFor="edit-year">Year published</label>
            <input id="edit-year" className="input" inputMode="numeric" value={year} autoComplete="off" onChange={(e) => setYear(e.target.value)} />
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label htmlFor="edit-pages">Pages</label>
            <input id="edit-pages" className="input" inputMode="numeric" value={pages} autoComplete="off" onChange={(e) => setPages(e.target.value)} />
          </div>
        </div>

        <section className="card stack" style={{ gap: 10 }} aria-labelledby="cover-h">
          <h2 id="cover-h" style={{ fontSize: 18 }}>
            Cover
          </h2>
          <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
            <div style={{ width: 90, flexShrink: 0 }}>
              <BookCover book={{ title: title || book.title, coverUrl: cover.trim() || undefined }} decorative />
            </div>
            <div className="stack" style={{ gap: 10, padding: 0, minWidth: 0, flex: 1 }}>
              <button type="button" className="btn btn--small" onClick={() => void refresh()} disabled={looking}>
                <Search size={16} aria-hidden="true" /> {looking ? "Looking…" : "Look up cover and details"}
              </button>
              {lookupMsg ? (
                <p className="muted" role="status" style={{ fontSize: 14 }}>
                  {lookupMsg}
                </p>
              ) : null}
            </div>
          </div>
          <div className="field">
            <label htmlFor="edit-cover">Cover image address (optional)</label>
            <input id="edit-cover" className="input" value={cover} autoComplete="off" placeholder="https://…" onChange={(e) => setCover(e.target.value)} />
          </div>
        </section>

        <fieldset className="field" style={{ border: 0, padding: 0 }}>
          <legend className="muted" style={{ marginBottom: 8 }}>
            Genres
          </legend>
          <div className="statusbar">
            {GENRES.map((g) => (
              <button key={g} type="button" className={`chip${genres.includes(g) ? " is-on" : ""}`} aria-pressed={genres.includes(g)} onClick={() => toggle(genres, setGenres, g)}>
                {g}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset className="field" style={{ border: 0, padding: 0 }}>
          <legend className="muted" style={{ marginBottom: 8 }}>
            Moods
          </legend>
          <div className="statusbar">
            {MOODS.map((m) => (
              <button key={m} type="button" className={`chip${moods.includes(m) ? " is-on" : ""}`} aria-pressed={moods.includes(m)} onClick={() => toggle(moods, setMoods, m)}>
                {m}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset className="field" style={{ border: 0, padding: 0 }}>
          <legend className="muted" style={{ marginBottom: 8 }}>
            Lists this book is on
          </legend>
          <div className="statusbar">
            {listChoices.map((l) => (
              <button key={l} type="button" className={`chip${sources.includes(l) ? " is-on" : ""}`} aria-pressed={sources.includes(l)} onClick={() => toggle(sources, setSources, l)}>
                {l}
              </button>
            ))}
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <input aria-label="Another list name" className="input" value={newList} placeholder="Another list name" onChange={(e) => setNewList(e.target.value)} />
            <button
              type="button"
              className="btn"
              onClick={() => {
                const name = newList.trim();
                if (!name) return;
                if (!listChoices.includes(name)) setExtraLists([...extraLists, name]);
                if (!sources.includes(name)) setSources([...sources, name]);
                setNewList("");
              }}
            >
              Add
            </button>
          </div>
        </fieldset>

        <div className="field">
          <label htmlFor="edit-note">Notes that came with the book</label>
          <textarea id="edit-note" className="input" rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>

        {error ? <p className="error">{error}</p> : null}

        {duplicate ? (
          <div className="card stack" role="alert" style={{ gap: 10 }}>
            <p>
              <strong>{duplicate.title}</strong>
              {duplicate.author ? ` by ${duplicate.author}` : ""} is already in your library. These look like the same book.
            </p>
            <p className="muted" style={{ fontSize: 14 }}>
              Merging moves this book&apos;s lists, notes and tags onto that one and removes the extra copy.
            </p>
            <button type="button" className="btn btn--primary" disabled={busy} onClick={() => void merge(duplicate)}>
              Merge into that book
            </button>
            <button type="button" className="btn" disabled={busy} onClick={() => void save(true)}>
              Save as a separate book
            </button>
            <button type="button" className="btn" disabled={busy} onClick={() => setDuplicate(null)}>
              Keep editing
            </button>
          </div>
        ) : null}

        <button type="submit" className="btn btn--primary btn--block" disabled={busy}>
          {busy ? "Saving…" : "Save changes"}
        </button>
        <Link className="btn btn--block" href={ROUTES.book(book.id)}>
          Cancel
        </Link>
      </form>
    </div>
  );
}
