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
    instance =
      url && key && !forceLocal
        ? new SupabaseBookRepository(
            createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) as unknown as Db,
          )
        : new LocalBookRepository();
  }
  return instance;
}
