/** A tiny in-memory Storage, so repository tests don't depend on the browser. */
export function memoryStorage(initial: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(initial));
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k) => map.get(k) ?? null,
    key: (i) => [...map.keys()][i] ?? null,
    removeItem: (k) => void map.delete(k),
    setItem: (k, v) => void map.set(k, String(v)),
  };
}

/** Storage that reads fine but refuses to save (private mode, quota full). */
export function failingStorage(): Storage {
  const s = memoryStorage();
  s.setItem = () => {
    throw new Error("QuotaExceededError");
  };
  return s;
}
