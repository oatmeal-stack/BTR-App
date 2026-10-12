import { createClient } from "@supabase/supabase-js";
import type { BookRepository } from "./BookRepository";
import { LocalBookRepository } from "./LocalBookRepository";
import { SupabaseBookRepository, type Db } from "./SupabaseBookRepository";

let instance: BookRepository | null = null;

/**
 * One place that decides where the library is stored.
 * - Supabase settings present: the shared library (phone and computer see the same books).
 * - Otherwise, or with NEXT_PUBLIC_STORAGE=local: this device only.
 */
export function getRepository(): BookRepository {
  if (!instance) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    const forceLocal = process.env.NEXT_PUBLIC_STORAGE === "local";
    if (url && key && !forceLocal) {
      const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
      const db = client as unknown as Db;
      // The Amazon link reader is a server-side function: the browser can't read Amazon pages itself.
      db.invoke = (fn, body) => client.functions.invoke(fn, { body: body as Record<string, unknown> });
      instance = new SupabaseBookRepository(db);
    } else {
      instance = new LocalBookRepository();
    }
  }
  return instance;
}
