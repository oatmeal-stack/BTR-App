-- The four books Reading now starts with: The Hobbit, The Gates of Midnight, Genesis (the Bernard Beckett novel)
-- and The Alchemist. Run after schema.sql and seed.sql. Safe to run again: it never touches a book's dates, rating or
-- notes, and it adds the two books that aren't in the seed only if they're missing.
--
-- No start or finish dates are set: you press Start yourself. The Hobbit and The Alchemist keep the list tags the
-- seed already gave them (Fantasy Top 100 UK, Man Book Club); the two new books have no source tag yet (set one with
-- Edit). Covers: Genesis from Open Library, The Gates of Midnight from Google's keyless image URL (Open Library has
-- no record of it). Its page count isn't known, so it's blank rather than guessed.

insert into books (id, title, author, status, cover_url, page_count, asin, source_note) values
  ('bk-gates-of-midnight-wecker', 'The Gates of Midnight', 'Helene Wecker', 'reading',
   'https://books.google.com/books/content?vid=ISBN9780062468680&printsec=frontcover&img=1&zoom=1',
   null, '0062468685', 'Book 3 of the Golem and the Jinni trilogy (Harper, Sept 2026)'),
  ('bk-genesis-beckett', 'Genesis', 'Bernard Beckett', 'reading',
   'https://covers.openlibrary.org/b/id/6015807-M.jpg', 173, null, null)
on conflict (id) do nothing;

update books
   set status = 'reading', updated_at = now()
 where id in ('bk-hobbit-tolkien', 'bk-alchemist-coelho', 'bk-gates-of-midnight-wecker', 'bk-genesis-beckett')
   and status = 'want_to_read';
