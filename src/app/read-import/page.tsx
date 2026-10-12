"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, Check, Heart, TriangleAlert } from "lucide-react";
import type { ReadRow } from "@/domain/book";
import { editFromBook } from "@/domain/bookActions";
import { matchReadList, type ReadMatch } from "@/domain/readImport";
import { useLibrary } from "@/hooks/useLibrary";
import { newId } from "@/lib/ids";
import { lookupDetails, suggestAuthors } from "@/lib/openLibrary";
import { ROUTES } from "@/routes";
import { ScenicBanner } from "@/components/shared/ScenicBanner";

type Choice = { kind: "undecided" } | { kind: "book"; id: string } | { kind: "new" } | { kind: "skip" };

interface Row {
  match: ReadMatch;
  choice: Choice;
  /** For a new book: the author to add it with (you can type or accept a suggestion). */
  author: string;
  ideas: string[];
  looking: boolean;
}

const stars = (n: number) => "★".repeat(n) + "☆".repeat(5 - n);

function startingChoice(m: ReadMatch): Choice {
  if (m.confidence === "high") return { kind: "book", id: m.candidates[0].book.id };
  if (m.confidence === "none") return { kind: "new" };
  return { kind: "undecided" }; // a doubtful match is never decided for you
}

const toValue = (c: Choice) => (c.kind === "book" ? `book:${c.id}` : c.kind === "new" ? "new" : c.kind === "skip" ? "skip" : "");
const fromValue = (v: string): Choice =>
  v.startsWith("book:") ? { kind: "book", id: v.slice(5) } : v === "new" ? { kind: "new" } : v === "skip" ? { kind: "skip" } : { kind: "undecided" };

interface Result {
  /** The list they were put on, if you chose one. */
  list?: { id: string; name: string; count: number };
  marked: number;
  added: number;
  restored: number;
  skipped: number;
  failed: string[];
}

/**
 * Paste the books you've read. Each line is matched against your archive and you review every match before
 * anything changes: confident matches are ready, doubtful ones need your decision, and books not found
 * are added (with a cover where one can be found).
 */
export default function ReadImportPage() {
  return (
    <Suspense fallback={null}>
      <ReadImportView />
    </Suspense>
  );
}

function ReadImportView() {
  const draftId = useSearchParams().get("draft");
  const { books, removedBooks, ready, addBook, updateBook, markManyRead, drafts, setDraftStatus, lists, createList, addManyToList, requiresPasscode, unlocked } = useLibrary();
  const allBooks = useMemo(() => [...books, ...removedBooks], [books, removedBooks]);
  const [text, setText] = useState("");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [busy, setBusy] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [empty, setEmpty] = useState(false);
  // Optionally put everything imported on a list: "" for none, "__new" for a new one, or a list's id.
  const [listChoice, setListChoice] = useState("");
  const [newListName, setNewListName] = useState("");

  // Opened from a draft: its text is the list, ready to review (and the draft is marked added once imported).
  const draft = draftId ? drafts.find((d) => d.id === draftId) : undefined;
  const filledFrom = useRef<string | null>(null);
  useEffect(() => {
    if (!draft || filledFrom.current === draft.id) return;
    filledFrom.current = draft.id;
    setText(draft.body);
  }, [draft]);

  function review() {
    const matches = matchReadList(text, allBooks);
    setEmpty(matches.length === 0);
    setRows(matches.length ? matches.map((m) => ({ match: m, choice: startingChoice(m), author: m.entry.author ?? "", ideas: [], looking: false })) : null);
  }

  function patchRow(i: number, change: Partial<Row>) {
    setRows((rs) => rs?.map((r, n) => (n === i ? { ...r, ...change } : r)) ?? null);
  }

  async function findAuthor(i: number) {
    patchRow(i, { looking: true });
    const ideas = await suggestAuthors(rows![i].match.entry.title);
    patchRow(i, { looking: false, ideas });
  }

  const todo = rows?.filter((r) => r.choice.kind === "book" || r.choice.kind === "new") ?? [];
  const undecided = rows?.filter((r) => r.choice.kind === "undecided").length ?? 0;
  const skipped = rows?.filter((r) => r.choice.kind === "skip").length ?? 0;
  const confident = rows?.filter((r) => r.match.confidence === "high").length ?? 0;
  const toCheck = rows?.filter((r) => r.match.confidence === "low").length ?? 0;
  const brandNew = rows?.filter((r) => r.match.confidence === "none").length ?? 0;

  async function run() {
    if (!rows) return;
    setBusy({ done: 0, total: todo.length });
    const readRows: ReadRow[] = [];
    const failed: string[] = [];
    let added = 0;
    let restored = 0;
    let n = 0;
    for (const r of todo) {
      const e = r.match.entry;
      let id: string | undefined;
      let restore = false;
      if (r.choice.kind === "book") {
        const b = allBooks.find((x) => x.id === (r.choice as { id: string }).id);
        id = b?.id;
        restore = Boolean(b?.removedAt);
      } else {
        const res = await addBook({ title: e.title, author: r.author.trim() || undefined, sources: [{ source: "Already read" }] });
        if (res) {
          id = res.book.id;
          restore = Boolean(res.book.removedAt);
          if (res.created) {
            added++;
            // A cover and page count where Open Library is confident. (Its years are unreliable, so no year.)
            const found = r.author.trim() ? await lookupDetails(e.title, r.author.trim()) : null;
            if (found && (found.coverUrl || found.pageCount)) {
              await updateBook(res.book.id, { ...editFromBook(res.book), coverUrl: found.coverUrl, pageCount: found.pageCount });
            }
          }
        }
      }
      if (id) {
        if (restore) restored++;
        readRows.push({ id, myRating: e.rating, favorite: e.favorite ? true : undefined, note: e.comment, noteId: e.comment ? newId("note") : undefined, restore });
      } else {
        failed.push(e.title);
      }
      setBusy({ done: ++n, total: todo.length });
    }
    let marked = 0;
    if (readRows.length && (await markManyRead(readRows))) marked = readRows.length;
    else if (readRows.length) failed.push(`${readRows.length} books couldn't be marked read`);
    // Put them all on the chosen list, in the order you pasted them.
    let list: Result["list"];
    if (marked > 0 && listChoice) {
      let listId: string | undefined = listChoice === "__new" ? undefined : listChoice;
      let listName = lists.find((l) => l.id === listId)?.name ?? "";
      if (listChoice === "__new") {
        const wanted = newListName.trim();
        const same = lists.find((l) => l.name.trim().toLowerCase() === wanted.toLowerCase());
        if (same) {
          listId = same.id;
          listName = same.name;
        } else {
          const made = await createList(wanted);
          if ("id" in made) {
            listId = made.id;
            listName = wanted;
          } else {
            failed.push(`couldn't make the list ${wanted}`);
          }
        }
      }
      if (listId) {
        const ids = [...new Set(readRows.map((r) => r.id))];
        if (await addManyToList(listId, ids)) list = { id: listId, name: listName, count: ids.length };
        else failed.push(`couldn't put them on ${listName}`);
      }
    }
    setBusy(null);
    if (draft && marked > 0 && failed.length === 0) await setDraftStatus(draft.id, "added");
    setResult({ marked, added, restored, skipped: skipped + undecided, failed, list });
  }

  return (
    <>
      <ScenicBanner slot="browseBanner" title="Books I've read" subtitle="Paste a list and check it before anything changes." />
      <div className="stack">
        <Link className="back" href={ROUTES.library}>
          <ArrowLeft size={16} aria-hidden="true" /> Library
        </Link>

        {ready && requiresPasscode && !unlocked ? (
          <p className="card" role="status">
            Importing needs your passcode. <Link href={ROUTES.profile}>Enter it in Profile</Link> first.
          </p>
        ) : null}

        {result ? (
          <section className="card stack" role="status" aria-label="Import finished">
            <h2 style={{ fontSize: 20 }}>Done</h2>
            <p>
              Marked <strong>{result.marked}</strong> {result.marked === 1 ? "book" : "books"} as read
              {result.added ? <>, including <strong>{result.added}</strong> new {result.added === 1 ? "book" : "books"} added to your archive</> : null}
              {result.restored ? <>, and brought back {result.restored} you&apos;d removed</> : null}.
            </p>
            {result.list ? (
              <p>
                Put <strong>{result.list.count}</strong> on <Link href={ROUTES.myList(result.list.id)}>{result.list.name}</Link>.
              </p>
            ) : null}
            {result.skipped ? <p className="muted">{result.skipped} left alone.</p> : null}
            {result.failed.length ? (
              <p className="error">
                Couldn&apos;t finish: {result.failed.join("; ")}. Try those again.
              </p>
            ) : null}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <Link className="btn btn--primary" href={ROUTES.library}>
                See my library
              </Link>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  setResult(null);
                  setRows(null);
                  setText("");
                }}
              >
                Import another list
              </button>
            </div>
          </section>
        ) : !rows ? (
          <section className="stack" style={{ padding: 0 }}>
            <div className="field">
              <label htmlFor="read-text">The books you&apos;ve read</label>
              <textarea
                id="read-text"
                className="input"
                rows={10}
                value={text}
                placeholder={"The Martian by Andy Weir – liked\nDune – Frank Herbert\nCity of Thieves"}
                onChange={(e) => {
                  setText(e.target.value);
                  setEmpty(false);
                }}
              />
            </div>
            <p className="muted" style={{ fontSize: 14 }}>
              One book per line: just the title, &ldquo;Title by Author&rdquo; or &ldquo;Title – Author&rdquo;. Add what you thought
              after a dash (&ldquo;loved&rdquo;, &ldquo;liked&rdquo;, &ldquo;ok&rdquo;) and it becomes your rating and a private note;
              &ldquo;a favorite of all time&rdquo; hearts it.
            </p>
            {empty ? <p className="error">I couldn&apos;t find any books in that. Put one per line.</p> : null}
            <button type="button" className="btn btn--primary btn--block" disabled={!ready || !text.trim()} onClick={review}>
              Review matches
            </button>
          </section>
        ) : (
          <>
            <section className="card" aria-label="Summary">
              <p>
                <strong>{rows.length}</strong> {rows.length === 1 ? "line" : "lines"}: {confident} matched, {toCheck} to check, {brandNew} not in your archive yet.
              </p>
              {undecided ? (
                <p className="muted" style={{ fontSize: 14, marginTop: 6 }}>
                  {undecided} still {undecided === 1 ? "needs" : "need"} your decision and will be left alone until you choose.
                </p>
              ) : null}
            </section>

            <ul className="stack" style={{ padding: 0, listStyle: "none", gap: 10 }}>
              {rows.map((r, i) => {
                const e = r.match.entry;
                const chosen = r.choice.kind === "book" ? allBooks.find((b) => b.id === (r.choice as { id: string }).id) : undefined;
                return (
                  <li key={`${i}-${e.raw}`} className="card stack" style={{ gap: 8 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
                      <span style={{ minWidth: 0 }}>
                        <strong style={{ overflowWrap: "anywhere" }}>{e.title}</strong>
                        {e.author ? <span className="muted"> — {e.author}</span> : null}
                      </span>
                      <span className="muted" style={{ fontSize: 13, whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: 4 }}>
                        {r.choice.kind === "undecided" ? (
                          <>
                            <TriangleAlert size={14} aria-hidden="true" /> Check this
                          </>
                        ) : r.choice.kind === "skip" ? (
                          "Skipped"
                        ) : r.choice.kind === "new" ? (
                          "New book"
                        ) : (
                          <>
                            <Check size={14} aria-hidden="true" /> Match
                          </>
                        )}
                      </span>
                    </div>
                    {e.rating || e.comment ? (
                      <p className="muted" style={{ fontSize: 14 }}>
                        {e.rating ? <span aria-label={`${e.rating} stars`}>{stars(e.rating)}</span> : null}
                        {e.comment ? <> · “{e.comment}”</> : null}
                        {e.favorite ? (
                          <>
                            {" "}· <Heart size={13} aria-hidden="true" style={{ verticalAlign: "-2px" }} /> favorite
                          </>
                        ) : null}
                      </p>
                    ) : null}
                    <div className="field">
                      <label htmlFor={`pick-${i}`}>{`What is “${e.title}”?`}</label>
                      <select id={`pick-${i}`} className="select" value={toValue(r.choice)} onChange={(ev) => patchRow(i, { choice: fromValue(ev.target.value) })}>
                        {r.choice.kind === "undecided" ? <option value="">Choose…</option> : null}
                        {r.match.candidates.map((c) => (
                          <option key={c.book.id} value={`book:${c.book.id}`}>
                            {c.book.title}
                            {c.book.author ? ` — ${c.book.author}` : ""}
                            {c.book.removedAt ? " (removed earlier)" : ""}
                            {c.book.status === "read" ? " (already read)" : ""}
                          </option>
                        ))}
                        <option value="new">Add as a new book</option>
                        <option value="skip">Skip this one</option>
                      </select>
                    </div>
                    {chosen?.status === "read" ? <p className="muted" style={{ fontSize: 13 }}>Already marked read; your rating and note will be added.</p> : null}
                    {chosen?.removedAt ? <p className="muted" style={{ fontSize: 13 }}>You removed this earlier; it will be restored.</p> : null}
                    {r.choice.kind === "new" ? (
                      <div className="stack" style={{ padding: 0, gap: 8 }}>
                        <div className="field">
                          <label htmlFor={`author-${i}`}>{`Author of “${e.title}”`}</label>
                          <input id={`author-${i}`} className="input" value={r.author} autoComplete="off" placeholder="Optional, but lets me find a cover" onChange={(ev) => patchRow(i, { author: ev.target.value })} />
                        </div>
                        {!r.author.trim() ? (
                          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                            <button type="button" className="btn btn--small" disabled={r.looking} onClick={() => void findAuthor(i)}>
                              {r.looking ? "Looking…" : "Suggest an author"}
                            </button>
                            {r.ideas.map((a) => (
                              <button key={a} type="button" className="chip" onClick={() => patchRow(i, { author: a, ideas: [] })}>
                                Use {a}
                              </button>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>

            {!requiresPasscode || unlocked ? (
              <section className="card stack" style={{ gap: 10 }} aria-label="Put them on a list">
                <div className="field">
                  <label htmlFor="read-list">Also put these books on a list (optional)</label>
                  <select id="read-list" className="select" value={listChoice} onChange={(e) => setListChoice(e.target.value)}>
                    <option value="">No list</option>
                    {lists.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
                    <option value="__new">New list…</option>
                  </select>
                </div>
                {listChoice === "__new" ? (
                  <div className="field">
                    <label htmlFor="read-list-name">New list name</label>
                    <input id="read-list-name" className="input" value={newListName} placeholder="Books previously read" onChange={(e) => setNewListName(e.target.value)} />
                  </div>
                ) : null}
              </section>
            ) : null}

            {busy ? (
              <p className="card" role="status">
                Importing… {busy.done} of {busy.total}
              </p>
            ) : null}
            <button type="button" className="btn btn--primary btn--block" disabled={todo.length === 0 || busy !== null || (listChoice === "__new" && !newListName.trim())} onClick={() => void run()}>
              {busy ? "Importing…" : `Import ${todo.length} ${todo.length === 1 ? "book" : "books"}`}
            </button>
            <button type="button" className="btn btn--block" disabled={busy !== null} onClick={() => setRows(null)}>
              Back to the list
            </button>
          </>
        )}
      </div>
    </>
  );
}
