"use client";

import { EmptyState } from "./EmptyState";

/** Shown instead of a misleading "empty" screen when the library couldn't be loaded. */
export function LoadProblem() {
  return (
    <EmptyState
      title="Couldn't load your library"
      body="Check your connection and try again. If you just set up the database, make sure the three SQL files have been run."
      action={
        <button type="button" className="btn btn--primary" onClick={() => window.location.reload()}>
          Try again
        </button>
      }
    />
  );
}
