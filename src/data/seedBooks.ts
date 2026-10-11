import type { Book } from "@/domain/book";
import seed from "./seedBooks.json";

/**
 * Your real library, built from the five lists by `npx tsx scripts/build-seed.ts`.
 * Do not edit seedBooks.json by hand: change data/raw or data/tags.json and re-run.
 */
export const SEED_BOOKS = seed as unknown as Book[];
