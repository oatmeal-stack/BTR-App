"use client";

import type { ReactNode } from "react";
import { useLibrary } from "@/hooks/useLibrary";
import { QuickNote } from "@/components/drafts/QuickNote";
import { BottomNavigation } from "./BottomNavigation";

export function AppShell({ children }: { children: ReactNode }) {
  const { notice, clearNotice, undoable, undoRemove } = useLibrary();
  return (
    <div className="app">
      <main className="shell">{children}</main>
      {undoable ? (
        <div className="toast" role="status">
          <span>
            Removed <strong>{undoable.title}</strong>
          </span>
          <button type="button" className="btn btn--small btn--primary" onClick={() => void undoRemove()}>
            Undo
          </button>
        </div>
      ) : notice ? (
        <div className="toast" role="status">
          <span>{notice}</span>
          <button type="button" className="btn btn--small" onClick={clearNotice}>
            Dismiss
          </button>
        </div>
      ) : null}
      <QuickNote />
      <BottomNavigation />
    </div>
  );
}
