"use client";

import { useId, useState, type FormEvent } from "react";
import { Lock, LockOpen } from "lucide-react";
import { useLibrary } from "@/hooks/useLibrary";

/** Shows where the library lives and, on the shared library, lets this device unlock changes. */
export function PasscodeSection() {
  const { requiresPasscode, unlocked, unlock, lock, storageLabel } = useLibrary();
  const inputId = useId();
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  if (!requiresPasscode) {
    return (
      <section aria-labelledby="where-h" className="card" style={{ fontSize: 14 }}>
        <h2 id="where-h" style={{ fontSize: 18, marginBottom: 6 }}>
          Where your library lives
        </h2>
        <p className="muted">
          {storageLabel}. It isn&apos;t shared with your other devices yet, so there&apos;s no passcode.
        </p>
      </section>
    );
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!code.trim()) {
      setError("Enter your passcode first.");
      return;
    }
    setError("");
    setBusy(true);
    const ok = await unlock(code.trim());
    setBusy(false);
    if (ok) setCode("");
    else setError("That passcode isn't right.");
  }

  return (
    <section aria-labelledby="where-h" className="card" style={{ fontSize: 14 }}>
      <h2 id="where-h" style={{ fontSize: 18, marginBottom: 6 }}>
        Passcode
      </h2>
      <p className="muted" style={{ marginBottom: 12 }}>
        {storageLabel}. Anyone with the link can browse it. Your passcode is needed to change books and
        to see your private notes.
      </p>
      {unlocked ? (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <LockOpen size={18} aria-hidden="true" /> Unlocked on this device
          </span>
          <button type="button" className="btn btn--small" onClick={lock}>
            <Lock size={16} aria-hidden="true" /> Lock
          </button>
        </div>
      ) : (
        <form onSubmit={submit} noValidate style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div className="field">
            <label htmlFor={inputId}>Passcode</label>
            <input
              id={inputId}
              className="input"
              type="password"
              autoComplete="off"
              value={code}
              onChange={(e) => {
                setCode(e.target.value);
                setError("");
              }}
            />
          </div>
          {error ? <p className="error">{error}</p> : null}
          <button type="submit" className="btn btn--primary" disabled={busy}>
            {busy ? "Checking…" : "Unlock"}
          </button>
        </form>
      )}
    </section>
  );
}
