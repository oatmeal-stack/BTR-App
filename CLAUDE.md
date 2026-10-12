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
- **Remove is a soft delete** (`books.removed_at`). A removed book keeps its row, sources, notes and lists and is
  hidden everywhere: the provider's `books` never contains it (`removedBooks`/`findBook` do), and every
  find/pick/count function also skips it. `remove_book` stores the book's normalized key (`importKey`: title
  without article + author last name) in `removed_keys`, and `seed.sql` skips any row whose key is there, so a
  re-import can't bring it back even under a different spelling. Adding a removed title again finds the old row
  (it stays removed) and the Add screen offers Restore. Restoring clears the key.
- **Read**: `status = 'read'` plus `finished_on` (date) and `my_rating` (1-5; NOT the Man Book Club `rating`),
  both kept when you un-mark it. Book page: "Mark as read" toggle + a "Your reading" card (date, stars, notes
  stay in the normal private notes). Cover tiles get a Read badge; Browse has "Hide read"; random picks (Home,
  a list's "Pick one for me") skip read books unless Profile > "Include books I've read" (per-device, `prefs.ts`).
- **Books I've read import** (`/read-import`, reachable from Library and from a Draft): paste lines like
  "Title by Author – loved - a favorite of all time". `readImport.ts` parses them (your verdict -> stars via
  `VERDICT_STARS`, the full phrase -> a private note, "favorite of all time" -> heart) and matches each line to the
  archive. Confident matches are ready; doubtful ones (and any series line, which has no single book) are NEVER
  decided for you; unmatched lines are added as new books (source "Already read", cover + pages looked up when an
  author is known, never an Open Library year). A removed book that matches is restored. Applied in one
  `mark_read_bulk` call, and can put every imported book on a new or existing list (`add_many_to_list`, in pasted
  order). The owner's 54-book starter list was imported this way into the list "Books previously read". Starter list text lives in `data/private/` (gitignored: never commit reading history).
- **My lists** (`my_lists`, `my_list_books`) are private (readable only through `list_my_data(token)`), unlike the
  public source tags in `book_sources`. A book can be on many lists; deleting a list deletes only the list and its
  memberships, never a book. Memberships survive a book's removal (the app just hides removed books), so
  restoring brings the place back. Lists have an order (a queue), reorderable with up/down arrows on the list
  screen (`/mylist?id=`). The three starting lists (couples club, Rough Drafts potentials, personal) were created
  directly in the database; their names are deliberately NOT in the public repo.
- **Drafts** (`inbox_notes`, screen `/drafts`, floating Quick note button) are private rough notes. There is no
  function to delete or rewrite one: only the status changes (new / added / dismissed), so the original text is
  never lost. "Make it a book" opens Add with a guessed title and author (`guessBookFromNote`) for you to correct.
  The mic uses the browser's speech recognition and is simply not shown where unsupported.
- **Edit a book** (`/edit?id=`): one form replaces title, author, year, pages, cover, genres, moods, lists and the
  imported note together (`update_book`; ids never change). If the edit makes the book match another visible one
  (`findDuplicate`), it asks: merge (`merge_books`: lists, notes, tags and gaps move to the kept book, the other
  copy is *removed*, never deleted), save separately, or keep editing. "Look up cover and details" uses Open
  Library from the browser and only fills BLANK year/pages (it reports what it saw instead of overwriting).
- **Publication year and page count** show on the book page (`bookFacts`). The year is a YEAR only (sources
  give no dates). Source order: your own lists > Wikidata, but a Wikidata year is only used when Open Library's
  agrees within 2 years (`agreedYears`), because each alone is wrong for 1 book in 5 to 15 (OL said Song of
  Solomon 1634, Frankenstein 2017). Otherwise it stays blank rather than wrong. Page counts come from Open
  Library (sanity 40-3000). Scripts: `fetch-facts.mts` (pages + OL year for cross-check), `fetch-years.mts`
  (Wikidata). `supabase/facts.sql` fills only blanks on the live DB.
- Open Library matching (`src/lib/openLibrary.ts`) requires title AND author; a title only counts if it equals
  the wanted one or differs by a subtitle ("Dune Messiah" is NOT "Dune").
- **Supabase rejects a DELETE or UPDATE with no WHERE** (safeupdate), but the in-memory test database doesn't.
  A bare `delete from login_failures;` once made every CORRECT sign-in fail with a 400 on the live site while
  all tests passed. `src/tests/sqlSafety.test.ts` now scans the SQL files; write `where true` when you mean all rows.
- No accounts. The library is publicly readable; every write needs a login token checked inside the
  database. Private notes are not publicly readable.
- **Sign-in and lockout**: the passcode is only ever sent to `login(p_code)`, which returns a random 90-day
  session token (stored hashed in `app_sessions`); the device keeps the token, never the passcode, and every
  write function takes the token as `p_code`. `login` allows 5 wrong tries per 15 min and 20 per day, then
  refuses even the right passcode (already signed-in devices keep working). It returns null for a wrong
  passcode instead of raising, because a raised error would roll back the failure count. Do not "simplify"
  that. Clear a lockout by hand with `delete from login_failures;`. Re-running set_passcode.sql signs all
  devices out. The owner's passcode is a short numeric code, so this lockout is what protects it.
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
