"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { ChevronRight, NotebookPen, Plus } from "lucide-react";
import { listCounts } from "@/domain/bookActions";
import { listBookCounts, waitingDrafts } from "@/domain/listActions";
import { useLibrary } from "@/hooks/useLibrary";
import { ROUTES } from "@/routes";
import { EmptyState } from "@/components/shared/EmptyState";
import { LoadProblem } from "@/components/shared/LoadProblem";
import { ScenicBanner } from "@/components/shared/ScenicBanner";

export default function ListsPage() {
  const { books, ready, loadFailed, lists: myLists, listItems, drafts, createList, requiresPasscode, unlocked } = useLibrary();
  const lists = listCounts(books);
  const counts = listBookCounts(books, listItems, myLists);
  const waiting = waitingDrafts(drafts).length;
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const locked = requiresPasscode && !unlocked;

  async function make(e: FormEvent) {
    e.preventDefault();
    const result = await createList(name);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    setError("");
    setName("");
  }

  return (
    <>
      <ScenicBanner slot="browseBanner" title="Lists" subtitle="Yours, and where your books came from." />
      <div className="stack">
        <section aria-labelledby="mine-h" className="stack" style={{ padding: 0, gap: 10 }}>
          <h2 id="mine-h" style={{ fontSize: 18 }}>
            My lists
          </h2>
          {ready && locked ? (
            <p className="card muted" style={{ fontSize: 14 }}>
              Your lists and drafts are private. <Link href={ROUTES.profile}>Enter your passcode in Profile</Link> to see them.
            </p>
          ) : ready ? (
            <>
              {myLists.length === 0 ? (
                <p className="muted" style={{ fontSize: 14 }}>
                  Make a list for anything: a book club, a stack for the summer, books to read together.
                </p>
              ) : null}
              {myLists.map((l) => (
                <Link key={l.id} className="card listcard" href={ROUTES.myList(l.id)}>
                  <span>
                    <strong>{l.name}</strong>
                  </span>
                  <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span className="count">{counts.get(l.id) ?? 0}</span>
                    <ChevronRight size={18} aria-hidden="true" />
                  </span>
                </Link>
              ))}
              <form onSubmit={make} noValidate style={{ display: "flex", gap: 8 }}>
                <input
                  aria-label="New list name"
                  className="input"
                  value={name}
                  placeholder="+ New list"
                  onChange={(e) => {
                    setName(e.target.value);
                    setError("");
                  }}
                />
                <button type="submit" className="btn" style={{ whiteSpace: "nowrap", flexShrink: 0 }} disabled={!name.trim()}>
                  <Plus size={16} aria-hidden="true" /> Make list
                </button>
              </form>
              {error ? <p className="error">{error}</p> : null}
              <Link className="card listcard" href={ROUTES.drafts}>
                <span>
                  <strong>Drafts</strong>
                  <span className="muted" style={{ display: "block", fontSize: 14 }}>
                    Notes to turn into books later
                  </span>
                </span>
                <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <NotebookPen size={18} aria-hidden="true" />
                  <span className="count">{waiting}</span>
                </span>
              </Link>
            </>
          ) : null}
        </section>

        <h2 style={{ fontSize: 18 }}>Where your books came from</h2>
        {!ready ? (
          <p className="muted">Loading your library…</p>
        ) : loadFailed ? (
          <LoadProblem />
        ) : lists.length === 0 ? (
          <EmptyState title="No lists yet" body="Books you add will show up here by source." />
        ) : (
          lists.map((l) => (
            <Link key={l.source} className="card listcard" href={ROUTES.browseWith({ source: l.source })}>
              <span>
                <strong>{l.source}</strong>
                <span className="muted" style={{ display: "block", fontSize: 14 }}>
                  See these books
                </span>
              </span>
              <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span className="count">{l.count}</span>
                <ChevronRight size={18} aria-hidden="true" />
              </span>
            </Link>
          ))
        )}
      </div>
    </>
  );
}
