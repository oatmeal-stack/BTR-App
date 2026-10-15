# Bookshelf

A personal library of books worth reading: browse and search the shelf, line up what to read next, keep several
books going at once with notes as you read, and archive each one with your rating and take when you finish.

Live at https://oatmeal-stack.github.io/BTR-App/ (the repository keeps its old name, `BTR-App`, so the address
doesn't change).

## What's in it

- **Home** picks a random book to read next. **Browse** filters the whole shelf.
- **Reading** has three sections: *Reading now* (several books at once, each with Start and Finish and its notes),
  *Next books* (a ranked queue you can reorder), and *Finished* (the archive).
- **Library**, **Lists** and **Drafts** keep your statuses, your own lists and quick notes for books to add later.
- No accounts. The library is public to read; changing anything needs your passcode, which is checked inside the
  database. Notes, lists, the queue and your takes are private.

## Running it

```bash
npm install
npm run dev        # http://localhost:3000
npm test           # unit, screen and real-SQL tests
npm run lint
npx tsc --noEmit
npm run build      # static export for GitHub Pages
```

Without Supabase settings it keeps everything on the device. With them (see `.env.local` and the repository's
Actions variables) it uses the shared library. `CLAUDE.md` has the settled decisions, the database setup order
(`supabase/schema.sql`, then `set_passcode.sql`, then `seed.sql`) and the gotchas.
