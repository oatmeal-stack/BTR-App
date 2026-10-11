"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { PencilLine, X } from "lucide-react";
import { waitingDrafts } from "@/domain/listActions";
import { useLibrary } from "@/hooks/useLibrary";
import { ROUTES } from "@/routes";
import { DraftComposer } from "./DraftComposer";

/** Screens with a form of their own, where a floating button would only get in the way. */
const HIDE_ON = ["/add", "/edit", "/drafts"];

/** A button that is always reachable and opens a one-box note. A count shows how many drafts are waiting. */
export function QuickNote() {
  const { drafts, ready } = useLibrary();
  const path = usePathname() ?? "";
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  const waiting = waitingDrafts(drafts).length;

  useEffect(() => {
    if (!saved) return;
    const t = setTimeout(() => setSaved(false), 2500);
    return () => clearTimeout(t);
  }, [saved]);

  if (!ready || HIDE_ON.some((p) => path === p || path.startsWith(`${p}/`))) return null;

  return (
    <>
      {saved ? (
        <p className="quicknote__saved" role="status">
          Saved to your drafts
        </p>
      ) : null}
      {open ? (
        <div className="sheet" role="dialog" aria-label="Quick note">
          <div className="sheet__panel">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <strong style={{ fontFamily: "var(--font-heading)", fontSize: 18 }}>Quick note</strong>
              <button type="button" className="iconbtn iconbtn--quiet" aria-label="Close" onClick={() => setOpen(false)}>
                <X size={18} aria-hidden="true" />
              </button>
            </div>
            <DraftComposer
              autoFocus
              onSaved={() => {
                setOpen(false);
                setSaved(true);
              }}
            />
            <Link href={ROUTES.drafts} className="muted" style={{ fontSize: 14 }} onClick={() => setOpen(false)}>
              See all drafts{waiting ? ` (${waiting} waiting)` : ""}
            </Link>
          </div>
        </div>
      ) : (
        <button type="button" className="fab" aria-label={waiting ? `Quick note, ${waiting} waiting` : "Quick note"} onClick={() => setOpen(true)}>
          <PencilLine size={22} aria-hidden="true" />
          {waiting ? <span className="fab__badge">{waiting}</span> : null}
        </button>
      )}
    </>
  );
}
