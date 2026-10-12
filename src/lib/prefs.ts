import { useSyncExternalStore } from "react";

/**
 * Small per-device preferences (not shared between your devices, like the skin). Wrapped in try/catch
 * because storage can be blocked, in which case the default is used.
 */
const INCLUDE_READ_KEY = "book-archive:include-read";
const listeners = new Set<() => void>();

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => void listeners.delete(cb);
}

export function getIncludeRead(): boolean {
  try {
    return window.localStorage.getItem(INCLUDE_READ_KEY) === "1";
  } catch {
    return false;
  }
}

export function setIncludeRead(on: boolean): void {
  try {
    window.localStorage.setItem(INCLUDE_READ_KEY, on ? "1" : "0");
  } catch {
    /* kept for this visit only */
  }
  listeners.forEach((l) => l());
}

/** Whether random picks may include books you've read. Off by default: a random pick is for finding something new. */
export function useIncludeRead(): [boolean, (on: boolean) => void] {
  const on = useSyncExternalStore(subscribe, getIncludeRead, () => false);
  return [on, setIncludeRead];
}
