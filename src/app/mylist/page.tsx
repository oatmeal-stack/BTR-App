"use client";

import { Suspense, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowDown, ArrowLeft, ArrowUp, Dices, Pencil, Plus, Trash2, X } from "lucide-react";
import type { Book } from "@/domain/book";
import { filterBooks, pickRandom } from "@/domain/bookActions";
import { booksInList } from "@/domain/listActions";
import { useLibrary } from "@/hooks/useLibrary";
import { useIncludeRead } from "@/lib/prefs";
import { ROUTES } from "@/routes";
import { BookCard } from "@/components/books/BookCard";
import { BookCover } from "@/components/books/BookCover";
import { EmptyState } from "@/components/shared/EmptyState";
import { ScenicBanner } from "@/components/shared/ScenicBanner";
import { SearchInput } from "@/components/shared/SearchInput";

export default function MyListPage() {
  return (
    <Suspense fallback={null}>
      <MyListView />
    </Suspense>
  );
}

function MyListView() {
  const id = useSearchParams().get("id");
  const { books, lists, listItems, ready, requiresPasscode, unlocked } = useLibrary();
  const list = lists.find((l) => l.id === id);

  if (!ready) {
    return (
      <div className="stack">
        <p className="muted">Loading…</p>
      </div>
    );
  }
  if (requiresPasscode && !unlocked) {
    return (
      <div className="stack">
        <Link className="back" href={ROUTES.lists}>
          <ArrowLeft size={16} aria-hidden="true" /> Lists
        </Link>
        <EmptyState title="Your lists are private" body="Enter your passcode in Profile to see them." />
      </div>
    );
  }
  if (!list) {
    return (
      <div className="stack">
        <Link className="back" href={ROUTES.lists}>
          <ArrowLeft size={16} aria-hidden="true" /> Lists
        </Link>
        <EmptyState title="List not found" body="That list doesn't exist. It may have been deleted." />
      </div>
    );
  }
  return <ListBody listId={list.id} name={list.name} books={booksInList(books, listItems, list.id)} />;
}

function ListBody({ listId, name, books: members }: { listId: string; name: string; books: Book[] }) {
  const router = useRouter();
  const { books, renameList, deleteList, addToList, removeFromList, reorderList } = useLibrary();
  const [renaming, setRenaming] = useState(false);
  const [newName, setNewName] = useState(name);
  const [renameError, setRenameError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [reorder, setReorder] = useState(false);
  const [pick, setPick] = useState<Book | null>(null);
  const [query, setQuery] = useState("");
  const [includeRead] = useIncludeRead();
  const [pickNote, setPickNote] = useState("");

  const onList = useMemo(() => new Set(members.map((b) => b.id)), [members]);
  const matches = useMemo(
    () => (query.trim() ? filterBooks(books, { query }).filter((b) => !onList.has(b.id)).slice(0, 6) : []),
    [books, query, onList],
  );

  async function rename(e: FormEvent) {
    e.preventDefault();
    const result = await renameList(listId, newName);
    if ("error" in result) {
      setRenameError(result.error);
      return;
    }
    setRenameError("");
    setRenaming(false);
  }

  async function remove() {
    if (await deleteList(listId)) router.replace(ROUTES.lists);
  }

  function move(index: number, by: -1 | 1) {
    const ids = members.map((b) => b.id);
    const to = index + by;
    if (to < 0 || to >= ids.length) return;
    [ids[index], ids[to]] = [ids[to], ids[index]];
    void reorderList(listId, ids);
  }

  return (
    <>
      <ScenicBanner slot="browseBanner" title={name} subtitle={`${members.length} ${members.length === 1 ? "book" : "books"}`} />
      <div className="stack">
        <Link className="back" href={ROUTES.lists}>
          <ArrowLeft size={16} aria-hidden="true" /> Lists
        </Link>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" className="btn btn--small" disabled={members.length === 0} onClick={() => {
              const pool = includeRead ? members : members.filter((b) => b.status !== "read");
              setPick(pickRandom(pool, pick?.id) ?? null);
              setPickNote(pool.length ? "" : "You've read everything on this list.");
            }}>
            <Dices size={16} aria-hidden="true" /> Pick one for me
          </button>
          <button type="button" className={`btn btn--small${reorder ? " btn--primary" : ""}`} aria-pressed={reorder} onClick={() => setReorder(!reorder)}>
            {reorder ? "Done" : "Reorder"}
          </button>
          <button type="button" className="btn btn--small" onClick={() => { setRenaming(!renaming); setNewName(name); setRenameError(""); }}>
            <Pencil size={16} aria-hidden="true" /> Rename
          </button>
          <button type="button" className="btn btn--small" onClick={() => setConfirmDelete(true)}>
            <Trash2 size={16} aria-hidden="true" /> Delete list
          </button>
        </div>

        {renaming ? (
          <form onSubmit={rename} noValidate className="card stack" style={{ gap: 8 }}>
            <div className="field">
              <label htmlFor="rename-list">List name</label>
              <input id="rename-list" className="input" value={newName} onChange={(e) => setNewName(e.target.value)} autoFocus />
            </div>
            {renameError ? <p className="error">{renameError}</p> : null}
            <div style={{ display: "flex", gap: 8 }}>
              <button type="submit" className="btn btn--primary btn--small">
                Save name
              </button>
              <button type="button" className="btn btn--small" onClick={() => setRenaming(false)}>
                Cancel
              </button>
            </div>
          </form>
        ) : null}

        {confirmDelete ? (
          <div className="card stack" role="alert" style={{ gap: 10 }}>
            <p>
              Delete <strong>{name}</strong>? The books on it stay in your library; only the list goes.
            </p>
            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" className="btn btn--primary btn--small" onClick={() => void remove()}>
                Delete the list
              </button>
              <button type="button" className="btn btn--small" onClick={() => setConfirmDelete(false)}>
                Keep it
              </button>
            </div>
          </div>
        ) : null}

        {pickNote ? (
          <p className="muted" role="status">
            {pickNote}
          </p>
        ) : null}

        {pick ? (
          <section className="card" aria-label="Your pick">
            <p className="muted" style={{ fontSize: 14, marginBottom: 8 }}>
              How about…
            </p>
            <div style={{ maxWidth: 140 }}>
              <BookCard book={pick} />
            </div>
          </section>
        ) : null}

        {members.length === 0 ? (
          <EmptyState title="Nothing on this list yet" body="Search below to add a book, or use Add to list on any book page." />
        ) : reorder ? (
          <ul className="rows" aria-label="Reorder this list">
            {members.map((b, i) => (
              <li key={b.id} className="row">
                <Link className="row__main" href={ROUTES.book(b.id)}>
                  <BookCover book={b} decorative className="row__cover" />
                  <span className="row__text">
                    <span className="row__title">{b.title}</span>
                    {b.author ? <span className="row__author">{b.author}</span> : null}
                  </span>
                </Link>
                <button type="button" className="iconbtn iconbtn--quiet" aria-label={`Move ${b.title} up`} disabled={i === 0} onClick={() => move(i, -1)}>
                  <ArrowUp size={18} aria-hidden="true" />
                </button>
                <button type="button" className="iconbtn iconbtn--quiet" aria-label={`Move ${b.title} down`} disabled={i === members.length - 1} onClick={() => move(i, 1)}>
                  <ArrowDown size={18} aria-hidden="true" />
                </button>
                <button type="button" className="iconbtn iconbtn--quiet" aria-label={`Take ${b.title} off this list`} onClick={() => void removeFromList(listId, b.id)}>
                  <X size={18} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="grid">
            {members.map((b) => (
              <BookCard key={b.id} book={b} />
            ))}
          </div>
        )}

        <section aria-labelledby="add-to-this-h" className="stack" style={{ padding: 0, gap: 10 }}>
          <h2 id="add-to-this-h" style={{ fontSize: 18 }}>
            Add a book to this list
          </h2>
          <SearchInput label="Search your library" placeholder="Search your library" onChange={setQuery} onSubmit={setQuery} />
          {matches.map((b) => (
            <div key={b.id} className="card" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
              <span style={{ minWidth: 0 }}>
                <strong style={{ display: "block", overflowWrap: "anywhere" }}>{b.title}</strong>
                {b.author ? <span className="muted" style={{ fontSize: 14 }}>{b.author}</span> : null}
              </span>
              <button type="button" className="btn btn--small" aria-label={`Add ${b.title} to ${name}`} onClick={() => void addToList(listId, b.id)}>
                <Plus size={16} aria-hidden="true" /> Add
              </button>
            </div>
          ))}
          {query.trim() && matches.length === 0 ? <p className="muted">Nothing new to add for that search.</p> : null}
        </section>
      </div>
    </>
  );
}
