"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { ListPlus } from "lucide-react";
import { listIdsForBook } from "@/domain/listActions";
import { useLibrary } from "@/hooks/useLibrary";
import { ROUTES } from "@/routes";

/** "Add to list" on a book: tick the lists it belongs on, or make a new one and put it straight on. */
export function AddToList({ bookId }: { bookId: string }) {
  const { lists, listItems, addToList, removeFromList, createList, requiresPasscode, unlocked } = useLibrary();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const on = new Set(listIdsForBook(listItems, bookId));
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
    await addToList(result.id, bookId);
  }

  return (
    <div className="stack" style={{ padding: 0, gap: 10 }}>
      <button type="button" className="btn" aria-expanded={open} onClick={() => setOpen(!open)}>
        <ListPlus size={18} aria-hidden="true" /> {on.size ? `On ${on.size} ${on.size === 1 ? "list" : "lists"}` : "Add to list"}
      </button>
      {open ? (
        <div className="card stack" style={{ gap: 12 }} role="group" aria-label="Add to list">
          {locked ? (
            <p className="muted" style={{ fontSize: 14 }}>
              Your lists are private. <Link href={ROUTES.profile}>Enter your passcode in Profile</Link> to use them.
            </p>
          ) : (
            <>
              {lists.length === 0 ? (
                <p className="muted" style={{ fontSize: 14 }}>
                  You don&apos;t have any lists yet. Make your first one below.
                </p>
              ) : (
                <div className="statusbar">
                  {lists.map((l) => (
                    <button
                      key={l.id}
                      type="button"
                      className={`chip${on.has(l.id) ? " is-on" : ""}`}
                      aria-pressed={on.has(l.id)}
                      onClick={() => void (on.has(l.id) ? removeFromList(l.id, bookId) : addToList(l.id, bookId))}
                    >
                      {l.name}
                    </button>
                  ))}
                </div>
              )}
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
                <button type="submit" className="btn" disabled={!name.trim()}>
                  Add
                </button>
              </form>
              {error ? <p className="error">{error}</p> : null}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
