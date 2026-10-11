"use client";

import type { ReactNode } from "react";
import { useLibrary } from "@/hooks/useLibrary";
import { BottomNavigation } from "./BottomNavigation";

export function AppShell({ children }: { children: ReactNode }) {
  const { notice, clearNotice } = useLibrary();
  return (
    <div className="app">
      <main className="shell">{children}</main>
      {notice ? (
        <div className="toast" role="status">
          <span>{notice}</span>
          <button type="button" className="btn btn--small" onClick={clearNotice}>
            Dismiss
          </button>
        </div>
      ) : null}
      <BottomNavigation />
    </div>
  );
}
