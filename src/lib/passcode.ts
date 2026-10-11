/** Where the passcode is remembered on this device. Never sent anywhere except to Supabase. */
export interface PasscodeStore {
  get(): string | null;
  set(code: string): void;
  clear(): void;
}

export const PASSCODE_KEY = "book-archive:passcode";

/** Browser storage, with an in-memory fallback if storage is blocked (private mode). */
export function browserPasscodeStore(): PasscodeStore {
  let memory: string | null = null;
  return {
    get() {
      try {
        return window.localStorage.getItem(PASSCODE_KEY) ?? memory;
      } catch {
        return memory;
      }
    },
    set(code) {
      memory = code;
      try {
        window.localStorage.setItem(PASSCODE_KEY, code);
      } catch {
        /* kept in memory for this visit */
      }
    },
    clear() {
      memory = null;
      try {
        window.localStorage.removeItem(PASSCODE_KEY);
      } catch {
        /* nothing to clear */
      }
    },
  };
}

/** Thrown when a change needs the passcode and there isn't a working one. */
export class PasscodeRequiredError extends Error {
  constructor() {
    super("Passcode required");
    this.name = "PasscodeRequiredError";
  }
}
