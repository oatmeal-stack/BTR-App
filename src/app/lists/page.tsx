"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { listCounts } from "@/domain/bookActions";
import { useLibrary } from "@/hooks/useLibrary";
import { ROUTES } from "@/routes";
import { EmptyState } from "@/components/shared/EmptyState";
import { LoadProblem } from "@/components/shared/LoadProblem";
import { ScenicBanner } from "@/components/shared/ScenicBanner";

export default function ListsPage() {
  const { books, ready, loadFailed } = useLibrary();
  const lists = listCounts(books);

  return (
    <>
      <ScenicBanner slot="browseBanner" title="Lists" subtitle="Where your books came from." />
      <div className="stack">
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
