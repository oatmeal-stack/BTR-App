"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import type { InboxStatus } from "@/domain/book";
import { waitingDrafts } from "@/domain/listActions";
import { useLibrary } from "@/hooks/useLibrary";
import { ROUTES } from "@/routes";
import { DraftComposer } from "@/components/drafts/DraftComposer";
import { EmptyState } from "@/components/shared/EmptyState";
import { ScenicBanner } from "@/components/shared/ScenicBanner";

const when = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

const TABS: { status: InboxStatus; label: string }[] = [
  { status: "new", label: "Waiting" },
  { status: "added", label: "Added" },
  { status: "dismissed", label: "Dismissed" },
];

/** Rough notes about books to add later. The original text is kept exactly as typed, whatever happens to a draft. */
export default function DraftsPage() {
  const { drafts, ready, findBook, setDraftStatus, requiresPasscode, unlocked } = useLibrary();
  const [tab, setTab] = useState<InboxStatus>("new");
  const shown = drafts.filter((d) => d.status === tab);

  return (
    <>
      <ScenicBanner slot="browseBanner" title="Drafts" subtitle="Notes to turn into books later." />
      <div className="stack">
        <Link className="back" href={ROUTES.lists}>
          <ArrowLeft size={16} aria-hidden="true" /> Lists
        </Link>

        <section className="card" aria-label="New draft">
          <DraftComposer />
        </section>

        <div className="chips" role="group" aria-label="Show">
          {TABS.map((t) => {
            const n = drafts.filter((d) => d.status === t.status).length;
            return (
              <button key={t.status} type="button" className={`chip${tab === t.status ? " is-on" : ""}`} aria-pressed={tab === t.status} onClick={() => setTab(t.status)}>
                {t.label} ({n})
              </button>
            );
          })}
        </div>

        {!ready ? (
          <p className="muted">Loading…</p>
        ) : requiresPasscode && !unlocked ? (
          <EmptyState title="Drafts are private" body="Enter your passcode in Profile to see and save them." />
        ) : shown.length === 0 ? (
          <EmptyState
            title={tab === "new" ? "Nothing waiting" : tab === "added" ? "Nothing added yet" : "Nothing dismissed"}
            body={tab === "new" ? "Jot down a title, an author, or just a half-remembered idea above." : "They'll show up here."}
          />
        ) : (
          shown.map((d) => {
            const book = d.bookId ? findBook(d.bookId) : undefined;
            return (
              <article key={d.id} className="card notecard">
                <div className="notecard__meta">
                  <span>{when(d.createdAt)}</span>
                  {tab === "added" && book ? <Link href={ROUTES.book(book.id)}>Added as {book.title}</Link> : null}
                </div>
                <p style={{ whiteSpace: "pre-wrap" }}>{d.body}</p>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
                  {d.status === "new" ? (
                    <>
                      <Link className="btn btn--small btn--primary" href={`${ROUTES.add}?draft=${encodeURIComponent(d.id)}`}>
                        Make it a book
                      </Link>
                      <button type="button" className="btn btn--small" onClick={() => void setDraftStatus(d.id, "dismissed")}>
                        Dismiss
                      </button>
                    </>
                  ) : (
                    <button type="button" className="btn btn--small" onClick={() => void setDraftStatus(d.id, "new")}>
                      Back to waiting
                    </button>
                  )}
                </div>
              </article>
            );
          })
        )}
        <p className="muted" style={{ fontSize: 13 }}>
          {waitingDrafts(drafts).length} waiting
        </p>
      </div>
    </>
  );
}
