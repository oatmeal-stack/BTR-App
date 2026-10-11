@AGENTS.md

# Book Archive App

A personal, searchable library of "books worth reading" (586 books from five lists), browsed on
phone and desktop. **Not related to the `bookclubapp` repo** (a different app: a monthly
voting tool). Keep them separate.

## Stack and where things live

- Next.js (App Router) + TypeScript, `output: 'export'` (static) for GitHub Pages. Book pages use a
  query string (`/book?id=...`) because books are added after publishing.
- Supabase (new project, not the club app's) holds the shared library. Plan: GitHub Pages + Supabase.
- `src/domain` book rules (pure functions), `src/repositories` storage behind `BookRepository`
  (`LocalBookRepository` = this device today; a Supabase one comes next), `src/skins` themes,
  `src/hooks/useLibrary.tsx` app state, `src/app` the screens.
- `data/raw/*.psv` the five source lists, transcribed from the Drive folder "Book Club - Mens".
  `data/tags.psv` genres, moods and full author names (made by Claude, reviewable).
  `scripts/build-seed.ts` merges them into `src/data/seedBooks.json` and `supabase/seed.sql`.
  Do not hand-edit the generated files. Run `npx tsx scripts/build-seed.ts` after changing data.
- `supabase/schema.sql` + `set_passcode.sql` + `seed.sql`: run in that order in the SQL editor.

## Rules that were settled (don't re-litigate)

- Theme is presentation only. A skin is plain data (colors, fonts, radii, artwork paths): no routes,
  callbacks or book data. Switching skins must never change data, links or behavior or remount the app.
  Every field and button has a solid background; never put controls over scenic art.
- A book on several lists is stored once with every list tagged (matching = same title and same
  author last name, see `isSameBook`).
- Scores (out of 10) exist only for Man Book Club and show only on the book page.
- Amazon links are plain search links, never affiliate links.
- No accounts. The library is publicly readable; every write needs a passcode checked inside the
  database. Private notes are not publicly readable.
- Do not invent data: leave genres blank rather than guess; sample cover art is a placeholder tile.

## Commands

`npm run dev`, `npm run build`, `npm run lint`, `npm test`, `npx tsc --noEmit`.
Tests include a real in-memory Postgres run of the SQL files (`src/tests/database.test.ts`).

## Open items

- Spy sheet reports 125 rows but only 117 are readable; Man Book Club sheet lacked ranks 1-10
  (added from the club's public site, `data/raw/man-book-club-ranks-1-10.psv`).
- NYT reader picks: 74 entries named by 2+ different readers (data/raw/nyt-reader-picks.psv, made by
  scripts/comment-picks.ts from the local-only comments file). Counts only; no reader names are stored.
- Supabase is wired (`SupabaseBookRepository`, settings in `.env.local`, project wvyieihncpowqacuwrqk).
  schema.sql and the seed (586 books, 606 list tags, verified by fingerprint) are APPLIED to the live project
  (via the Supabase connector). The passcode is NOT set: the user sets it themselves with set_passcode.sql
  and Claude never sees it. Until then nobody can change anything. `NEXT_PUBLIC_STORAGE=local` forces
  this-device storage.
- That project also holds older club-style leftovers (tables club, meetings, ballots, schedule,
  organizer_secret and functions like update_book, delete_book). They are inert and untouched; the user may
  drop them. Claude must not delete user data, even when asked: give the user the SQL to run instead.
- **Deployed**: https://oatmeal-stack.github.io/BTR-App/ (repo github.com/oatmeal-stack/BTR-App, branch `main`,
  GitHub account `oatmeal-stack`, NOT the club account). `.github/workflows/deploy.yml` runs tsc, eslint, tests,
  then builds and publishes on every push to `main`. The two Supabase values live in the repo's Actions
  *variables* (public by design). The remote URL carries `oatmeal-stack@` so Windows asks for that account,
  not the club login saved for github.com. Repo commits use identity oatmeal-stack (local git config).
- CI lessons: (1) CI uses a newer npm than a laptop and wants `@emnapi/core` + `@emnapi/runtime` pinned in
  devDependencies; (2) code must type-check on a clean checkout, so never rely on Next's generated global
  types (`LayoutProps`, `PageProps`) from `.next/types`. Check with a fresh `git clone` + `npm ci` + `tsc`.
- **Covers**: `scripts/fetch-covers.mts` matches each book on Open Library (title AND author must agree, English
  editions preferred, cover looked up by cover id never ISBN) -> `data/covers.psv` (490 of 586). Unmatched
  books are listed in `data/covers-missing.txt` (mostly "series"/"author novels" entries, which correctly have
  no single cover) and keep the title tile; never guess. `build-seed.ts` bakes covers into `seedBooks.json`,
  `seed.sql`, and `supabase/covers.sql` (updates only rows with no cover yet; this is what was run on the live DB,
  verified by fingerprint). New books added later get no cover until one is set (`set_cover` exists, no UI yet).
- **Artwork**: `public/skins/<skin>/{pick-hero,browse-banner,empty-state,onboarding}.jpg` are STAND-INS cropped
  from the ChatGPT poster (`scripts/crop-poster-art.mjs`, ~270px source, upscaled). Replace with the real
  full-size files under the same names; no code change needed.
- Still open: bulk add (Claude API via an Edge Function), PWA, real artwork, setting the passcode.
