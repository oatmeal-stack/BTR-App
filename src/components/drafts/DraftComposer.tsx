"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import Link from "next/link";
import { Mic, Square } from "lucide-react";
import { useLibrary } from "@/hooks/useLibrary";
import { ROUTES } from "@/routes";

/** The little bit of the browser's speech recognition this uses. Not every browser has it. */
interface Recognition {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}
type RecognitionCtor = new () => Recognition;

function speechRecognition(): RecognitionCtor | undefined {
  if (typeof window === "undefined") return undefined;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

/**
 * One text box that saves a rough note in one tap. Works with the phone keyboard's own dictation key, and
 * adds a mic button where the browser can transcribe (it is simply not shown where it can't).
 */
export function DraftComposer({
  autoFocus = false,
  onSaved,
  onCancel,
}: {
  autoFocus?: boolean;
  onSaved?: () => void;
  onCancel?: () => void;
}) {
  const { addDraft, requiresPasscode, unlocked } = useLibrary();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  // Known only in the browser: the server render and first paint assume no mic, then it appears if supported.
  const canListen = useSyncExternalStore(
    () => () => {},
    () => Boolean(speechRecognition()),
    () => false,
  );
  const [listening, setListening] = useState(false);
  const [voiceMsg, setVoiceMsg] = useState("");
  const recognition = useRef<Recognition | null>(null);

  useEffect(() => () => recognition.current?.stop(), []);

  function toggleMic() {
    if (listening) {
      recognition.current?.stop();
      return;
    }
    const Ctor = speechRecognition();
    if (!Ctor) return;
    const r = new Ctor();
    const base = text.trim();
    r.continuous = false;
    r.interimResults = true;
    r.lang = "en-US";
    r.onresult = (e) => {
      const said = Array.from(e.results)
        .map((res) => res[0].transcript)
        .join(" ")
        .trim();
      setText(base ? `${base} ${said}` : said);
    };
    r.onerror = () => setVoiceMsg("Couldn't hear that. You can type, or use your keyboard's mic.");
    r.onend = () => setListening(false);
    recognition.current = r;
    setVoiceMsg("");
    setListening(true);
    try {
      r.start();
    } catch {
      setListening(false);
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!text.trim() || busy) return;
    recognition.current?.stop();
    setBusy(true);
    const ok = await addDraft(text);
    setBusy(false);
    if (ok) {
      setText("");
      onSaved?.();
    }
  }

  return (
    <form className="stack" style={{ padding: 0, gap: 10 }} onSubmit={submit}>
      {requiresPasscode && !unlocked ? (
        <p className="muted" role="status" style={{ fontSize: 14 }}>
          Drafts are private. <Link href={ROUTES.profile}>Enter your passcode in Profile</Link> to save one.
        </p>
      ) : null}
      <div className="field">
        <label htmlFor="draft-text">Quick note</label>
        <textarea
          id="draft-text"
          className="input"
          rows={4}
          value={text}
          autoFocus={autoFocus}
          placeholder="That spy novel about Berlin Mark mentioned…"
          onChange={(e) => setText(e.target.value)}
        />
      </div>
      {voiceMsg ? (
        <p className="muted" role="status" style={{ fontSize: 14 }}>
          {voiceMsg}
        </p>
      ) : null}
      <div style={{ display: "flex", gap: 10 }}>
        {canListen ? (
          <button type="button" className={`btn${listening ? " btn--primary" : ""}`} aria-pressed={listening} onClick={toggleMic}>
            {listening ? <Square size={16} aria-hidden="true" /> : <Mic size={18} aria-hidden="true" />} {listening ? "Stop" : "Speak"}
          </button>
        ) : null}
        <button type="submit" className="btn btn--primary" style={{ flex: 1 }} disabled={busy || !text.trim()}>
          {busy ? "Saving…" : "Save draft"}
        </button>
        {onCancel ? (
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
        ) : null}
      </div>
    </form>
  );
}
