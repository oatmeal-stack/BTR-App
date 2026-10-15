-- Bookshelf: database setup.
-- Run order in the Supabase SQL editor:
--   1. this file (schema.sql)
--   2. set_passcode.sql  (after you put your own passcode in it)
--   3. seed.sql          (your library)
-- Safe to run again; nothing here deletes data.
--
-- Who can do what:
--   * Anyone with the site link can READ the books and their lists.
--   * Nobody can write directly to a table.
--   * Every change goes through a function below that checks a login token. You get a token by
--     signing in with your passcode (login), which allows only a few wrong tries before it locks.
--   * Private notes are not readable by the public at all, only through list_notes(passcode).

create extension if not exists pgcrypto with schema extensions;

/* ---------- tables ---------- */

create table if not exists app_secret (
  id boolean primary key default true check (id),
  passcode_hash text not null
);

create table if not exists books (
  id text primary key,
  title text not null,
  author text,
  year int,
  status text not null default 'want_to_read'
    check (status in ('want_to_read', 'reading', 'read', 'abandoned')),
  rating numeric(3, 1),
  cover_url text,
  source_note text,
  favorite boolean not null default false,
  genres text[] not null default '{}',
  moods text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- A removed book is hidden by the app but never deleted (so it can be restored with its notes, lists and
-- tags). removed_keys remembers what was removed, by normalized title + author, so that re-running an
-- import doesn't bring it back even if the new copy is spelled a little differently.
alter table books add column if not exists removed_at timestamptz;

-- Page count (the year first published is the existing `year` column).
alter table books add column if not exists page_count int check (page_count is null or page_count > 0);

-- When you finished a book and what you thought of it (1 to 5 stars). Both optional; kept even if the book
-- is moved off "Read", so toggling it back doesn't lose them. Not the same as `rating`, which is the Man Book
-- Club score.
-- Amazon's product id (the ten-character code in a /dp/ link; for most books it is the ISBN-10), so a book can
-- link straight to its Amazon page. Never an affiliate tag.
alter table books add column if not exists asin text;

alter table books add column if not exists finished_on date;
alter table books add column if not exists my_rating int check (my_rating is null or my_rating between 1 and 5);

-- The day you pressed Start on a book you're reading. Only the Start button sets it (see start_reading).
alter table books add column if not exists started_on date;

create table if not exists removed_keys (
  key text primary key,
  book_id text,
  removed_at timestamptz not null default now()
);

create table if not exists book_sources (
  book_id text not null references books (id) on delete cascade,
  source text not null,
  rank int,
  primary key (book_id, source)
);

create table if not exists book_notes (
  id text primary key,
  book_id text not null references books (id) on delete cascade,
  body text not null check (length(trim(body)) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- A note can be tagged with the chapter (or part, or page) it is about, so reading notes stay in order.
alter table book_notes add column if not exists chapter text;

-- Wrong passcode tries (so guessing can be stopped) and signed-in devices. Only the functions below
-- touch these; nobody can read them.
create table if not exists login_failures (
  id bigint generated always as identity primary key,
  at timestamptz not null default now()
);

create table if not exists app_sessions (
  token_hash text primary key,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

-- Your own lists ("Couples book club"...), what is on them, and your drafts (rough notes about books to add
-- later). All private: nobody can read them without signing in, same as your notes.
create table if not exists my_lists (
  id text primary key,
  name text not null check (length(trim(name)) > 0),
  position int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists my_lists_name_idx on my_lists (lower(trim(name)));

-- A removed book keeps its row here too, so restoring it brings back its lists. Books are never deleted.
create table if not exists my_list_books (
  list_id text not null references my_lists (id) on delete cascade,
  book_id text not null references books (id),
  position int not null default 0,
  added_at timestamptz not null default now(),
  primary key (list_id, book_id)
);
create index if not exists my_list_books_book_idx on my_list_books (book_id);

create table if not exists inbox_notes (
  id text primary key,
  body text not null check (length(trim(body)) > 0),
  status text not null default 'new' check (status in ('new', 'added', 'dismissed')),
  book_id text references books (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Next books: the ranked queue of what to read next (position 0 is first). A book leaves it by itself the
-- moment it is being read or is read (see the trigger below). Private, like your lists.
create table if not exists next_books (
  book_id text primary key references books (id),
  position int not null default 0,
  added_at timestamptz not null default now()
);

-- "My Take": the short verdict written when a book is finished. One per book, private like notes.
create table if not exists book_takes (
  book_id text primary key references books (id),
  body text not null check (length(trim(body)) > 0),
  updated_at timestamptz not null default now()
);

create index if not exists books_status_idx on books (status);
create index if not exists book_sources_source_idx on book_sources (source);
create index if not exists book_notes_book_idx on book_notes (book_id);

/* ---------- who can read ---------- */

alter table app_secret enable row level security;   -- no policy: nobody can read it
alter table removed_keys enable row level security;   -- no policy: nobody can read it
alter table my_lists enable row level security;       -- no policy: private
alter table my_list_books enable row level security;
alter table inbox_notes enable row level security;
alter table next_books enable row level security;
alter table book_takes enable row level security;
alter table login_failures enable row level security;
alter table app_sessions enable row level security;
alter table books enable row level security;
alter table book_sources enable row level security;
alter table book_notes enable row level security;   -- no policy: notes are private

drop policy if exists "anyone can read books" on books;
create policy "anyone can read books" on books for select using (true);

drop policy if exists "anyone can read book sources" on book_sources;
create policy "anyone can read book sources" on book_sources for select using (true);

revoke all on app_secret from anon, authenticated;
revoke all on removed_keys from anon, authenticated;
revoke all on my_lists from anon, authenticated;
revoke all on my_list_books from anon, authenticated;
revoke all on inbox_notes from anon, authenticated;
revoke all on next_books from anon, authenticated;
revoke all on book_takes from anon, authenticated;
revoke all on login_failures from anon, authenticated;
revoke all on app_sessions from anon, authenticated;
revoke all on book_notes from anon, authenticated;
revoke insert, update, delete on books from anon, authenticated;
revoke insert, update, delete on book_sources from anon, authenticated;

/* ---------- passcode ---------- */

-- Is this a signed-in device? (p_code is the login token from login(), not the passcode.)
create or replace function check_code(p_code text)
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select exists (
    select 1 from app_sessions
    where token_hash = encode(digest(coalesce(p_code, ''), 'sha256'), 'hex')
      and expires_at > now()
  );
$$;

-- Sign in with the passcode. Returns a login token, or null for a wrong passcode. After 5 wrong tries
-- in 15 minutes (or 20 in a day) it refuses everything, even the right passcode, until the tries age
-- out. A wrong passcode returns null instead of raising an error on purpose: an error would undo the
-- record of the wrong try. To clear a lockout by hand: delete from login_failures;
create or replace function login(p_code text)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  recent int;
  today int;
  token text;
begin
  perform pg_advisory_xact_lock(hashtext('book-archive-login'));  -- one try at a time
  delete from login_failures where at < now() - interval '1 day';
  delete from app_sessions where expires_at < now();

  select count(*) filter (where at > now() - interval '15 minutes'), count(*) into recent, today from login_failures;
  if recent >= 5 or today >= 20 then
    raise exception 'Too many wrong tries. Try again later.' using errcode = 'P0423';
  end if;

  if not exists (select 1 from app_secret where passcode_hash = crypt(coalesce(p_code, ''), passcode_hash)) then
    insert into login_failures default values;
    return null;
  end if;

  token := encode(gen_random_bytes(24), 'hex');
  insert into app_sessions (token_hash, expires_at)
  values (encode(digest(token, 'sha256'), 'hex'), now() + interval '90 days');
  delete from login_failures where true;  -- Supabase refuses a DELETE or UPDATE that has no WHERE
  return token;
end;
$$;

-- Sign this device out.
create or replace function logout(p_code text)
returns void
language sql
security definer
set search_path = public, extensions
as $$
  delete from app_sessions where token_hash = encode(digest(coalesce(p_code, ''), 'sha256'), 'hex');
$$;

create or replace function require_code(p_code text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if not check_code(p_code) then
    raise exception 'Wrong passcode' using errcode = '28000';
  end if;
end;
$$;

/* ---------- changes (each one checks the passcode) ---------- */

create or replace function set_status(p_code text, p_id text, p_status text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  perform require_code(p_code);
  update books set status = p_status, updated_at = now() where id = p_id;
end;
$$;

-- Edit a book. Saves the whole form at once: a blank value clears the field, and the book's lists become
-- exactly p_sources (a list it was already on keeps its rank; with none given it goes on "My additions").
create or replace function update_book(
  p_code text, p_id text, p_title text, p_author text, p_year int, p_page_count int,
  p_cover_url text, p_genres text[], p_moods text[], p_source_note text, p_sources text[]
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  lists text[] := coalesce(nullif(p_sources, '{}'), array['My additions']);
begin
  perform require_code(p_code);
  if nullif(trim(p_title), '') is null then
    raise exception 'A book needs a title';
  end if;
  update books
     set title = trim(p_title),
         author = nullif(trim(p_author), ''),
         year = p_year,
         page_count = p_page_count,
         cover_url = nullif(trim(p_cover_url), ''),
         genres = coalesce(p_genres, '{}'),
         moods = coalesce(p_moods, '{}'),
         source_note = nullif(trim(p_source_note), ''),
         updated_at = now()
   where id = p_id;
  delete from book_sources where book_id = p_id and not (source = any (lists));
  insert into book_sources (book_id, source)
  select p_id, trim(s) from unnest(lists) s where trim(s) <> ''
  on conflict do nothing;
end;
$$;

-- Fold one copy of a book into another (the edit made them the same book). The kept book gains the other
-- one's lists, notes, tags and anything it was missing, and the other copy is removed (hidden, not deleted).
create or replace function merge_books(p_code text, p_keep text, p_drop text, p_key text default null)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  order_of text[] := array['want_to_read', 'abandoned', 'reading', 'read'];
begin
  perform require_code(p_code);
  if p_keep = p_drop then
    return;
  end if;
  insert into book_sources (book_id, source, rank)
  select p_keep, source, rank from book_sources where book_id = p_drop
  on conflict do nothing;
  update book_notes set book_id = p_keep where book_id = p_drop;
  insert into book_takes (book_id, body, updated_at)
  select p_keep, body, updated_at from book_takes where book_id = p_drop
  on conflict do nothing;
  delete from book_takes where book_id = p_drop;
  delete from next_books where book_id = p_drop;
  update books k
     set started_on = coalesce(k.started_on, d.started_on),
         year = coalesce(k.year, d.year),
         page_count = coalesce(k.page_count, d.page_count),
         cover_url = coalesce(k.cover_url, d.cover_url),
         rating = coalesce(k.rating, d.rating),
         source_note = nullif(concat_ws('. ', k.source_note,
           case when d.source_note is not null and position(d.source_note in coalesce(k.source_note, '')) = 0
                then d.source_note end), ''),
         genres = (select coalesce(array_agg(distinct g), '{}') from unnest(k.genres || d.genres) g),
         moods = (select coalesce(array_agg(distinct m), '{}') from unnest(k.moods || d.moods) m),
         favorite = k.favorite or d.favorite,
         status = case when array_position(order_of, d.status) > array_position(order_of, k.status) then d.status else k.status end,
         updated_at = now()
    from books d
   where k.id = p_keep and d.id = p_drop;
  update books set removed_at = coalesce(removed_at, now()), updated_at = now() where id = p_drop;
  if p_key is not null then
    insert into removed_keys (key, book_id) values (p_key, p_drop) on conflict (key) do nothing;
  end if;
end;
$$;

-- Your reading details for one book. A blank value clears the field.
create or replace function set_read_details(p_code text, p_id text, p_finished_on date, p_my_rating int)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  perform require_code(p_code);
  update books set finished_on = p_finished_on, my_rating = p_my_rating, updated_at = now() where id = p_id;
end;
$$;

/* ---------- reading now, next books, and finishing ---------- */

-- A book that is being read, or read, is no longer "next", whichever door it went through (the Start button,
-- the status chips, Mark as read, the Already Read import).
create or replace function leave_next_when_started()
returns trigger
language plpgsql
as $$
begin
  if new.status in ('reading', 'read') then
    delete from next_books where book_id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists books_leave_next on books;
create trigger books_leave_next
  after update of status on books
  for each row
  when (new.status is distinct from old.status)
  execute function leave_next_when_started();

-- Put a book at the end of the Next books queue. Books already being read, or read, can't be in it.
create or replace function add_to_next(p_code text, p_book_id text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  perform require_code(p_code);
  insert into next_books (book_id, position)
  select b.id, coalesce((select max(position) from next_books), -1) + 1
    from books b
   where b.id = p_book_id and b.status not in ('reading', 'read')
  on conflict do nothing;
end;
$$;

create or replace function remove_from_next(p_code text, p_book_id text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  perform require_code(p_code);
  delete from next_books where book_id = p_book_id;
end;
$$;

-- Put the queue in this order. Books not named keep their relative order after these.
create or replace function reorder_next(p_code text, p_book_ids text[])
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  perform require_code(p_code);
  update next_books m
     set position = o.ord - 1
    from unnest(p_book_ids) with ordinality as o(book_id, ord)
   where m.book_id = o.book_id;
  update next_books m
     set position = m.position + coalesce(array_length(p_book_ids, 1), 0)
   where not (m.book_id = any (p_book_ids));
end;
$$;

-- The Start button: the book is being read, from this day. The day comes from the phone (its own calendar
-- day), not the server's clock.
create or replace function start_reading(p_code text, p_id text, p_on date)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  perform require_code(p_code);
  update books set status = 'reading', started_on = p_on, updated_at = now() where id = p_id;
end;
$$;

-- The Finish button: read, on this day, with an optional rating (1 to 5) and an optional take. A blank take
-- removes any earlier one. The start date is left exactly as it was.
create or replace function finish_reading(p_code text, p_id text, p_on date, p_my_rating int, p_take text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  perform require_code(p_code);
  update books
     set status = 'read', finished_on = p_on, my_rating = p_my_rating, updated_at = now()
   where id = p_id;
  perform set_my_take(p_code, p_id, p_take);
end;
$$;

-- Write or clear the take on a finished book. Private.
create or replace function set_my_take(p_code text, p_id text, p_take text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  perform require_code(p_code);
  if p_take is null or length(trim(p_take)) = 0 then
    delete from book_takes where book_id = p_id;
  elsif exists (select 1 from books where id = p_id) then
    insert into book_takes (book_id, body) values (p_id, trim(p_take))
    on conflict (book_id) do update set body = excluded.body, updated_at = now();
  end if;
end;
$$;

-- Mark many books read at once (the "books I've read" import). Each row: id, my_rating, finished_on, favorite
-- (true to heart it, otherwise left alone), note_id + note (a private note, added once), restore (bring back a
-- book that was removed). Values you don't give are left as they were.
create or replace function mark_read_bulk(p_code text, p_rows jsonb)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  r record;
begin
  perform require_code(p_code);
  for r in
    select * from jsonb_to_recordset(p_rows)
      as x(id text, my_rating int, finished_on date, favorite boolean, note_id text, note text, restore boolean)
  loop
    update books
       set status = 'read',
           my_rating = coalesce(r.my_rating, my_rating),
           finished_on = coalesce(r.finished_on, finished_on),
           favorite = coalesce(r.favorite, favorite),
           removed_at = case when coalesce(r.restore, false) then null else removed_at end,
           updated_at = now()
     where id = r.id;
    if coalesce(r.restore, false) then
      delete from removed_keys where book_id = r.id;
    end if;
    if nullif(trim(coalesce(r.note, '')), '') is not null and r.note_id is not null then
      insert into book_notes (id, book_id, body) values (r.note_id, r.id, trim(r.note)) on conflict (id) do nothing;
    end if;
  end loop;
end;
$$;

-- Fill in details a book is missing (from an Amazon link, say). Only blanks are filled: a page count, cover or
-- Amazon id already there is never replaced.
create or replace function fill_book_details(p_code text, p_id text, p_page_count int, p_cover_url text, p_asin text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  perform require_code(p_code);
  update books
     set page_count = coalesce(page_count, p_page_count),
         cover_url = coalesce(cover_url, nullif(trim(p_cover_url), '')),
         asin = coalesce(asin, nullif(upper(trim(p_asin)), '')),
         updated_at = now()
   where id = p_id;
end;
$$;

-- Hide a book everywhere without deleting anything. p_key is its normalized title + author.
create or replace function remove_book(p_code text, p_id text, p_key text default null)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  perform require_code(p_code);
  update books set removed_at = coalesce(removed_at, now()), updated_at = now() where id = p_id;
  if p_key is not null and found then
    insert into removed_keys (key, book_id) values (p_key, p_id) on conflict (key) do nothing;
  end if;
end;
$$;

-- Bring a removed book back exactly as it was.
create or replace function restore_book(p_code text, p_id text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  perform require_code(p_code);
  update books set removed_at = null, updated_at = now() where id = p_id;
  delete from removed_keys where book_id = p_id;
end;
$$;

create or replace function set_favorite(p_code text, p_id text, p_favorite boolean)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  perform require_code(p_code);
  update books set favorite = p_favorite, updated_at = now() where id = p_id;
end;
$$;

create or replace function set_cover(p_code text, p_id text, p_url text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  perform require_code(p_code);
  update books set cover_url = p_url, updated_at = now() where id = p_id;
end;
$$;

-- Adds a brand-new book. The app checks for an existing copy first (see merge_book).
create or replace function add_book(
  p_code text, p_id text, p_title text, p_author text, p_year int,
  p_note text, p_source text, p_rank int default null
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  perform require_code(p_code);
  insert into books (id, title, author, year, source_note)
  values (p_id, trim(p_title), nullif(trim(p_author), ''), p_year, nullif(trim(p_note), ''))
  on conflict (id) do nothing;
  insert into book_sources (book_id, source, rank)
  values (p_id, p_source, p_rank)
  on conflict do nothing;
end;
$$;

-- The book is already in the library: add the new list and any new note, no duplicate row.
create or replace function merge_book(
  p_code text, p_id text, p_source text, p_rank int default null, p_note text default null
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  perform require_code(p_code);
  insert into book_sources (book_id, source, rank)
  values (p_id, p_source, p_rank)
  on conflict do nothing;
  update books
     set source_note = case
           when nullif(trim(p_note), '') is null then source_note
           when position(trim(p_note) in coalesce(source_note, '')) > 0 then source_note
           else concat_ws(' · ', source_note, trim(p_note))
         end,
         updated_at = now()
   where id = p_id;
end;
$$;

/* ---------- your lists and drafts (private) ---------- */

-- Everything private at once: your lists, what is on them, and your drafts.
create or replace function list_my_data(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  perform require_code(p_code);
  return jsonb_build_object(
    'lists', coalesce((select jsonb_agg(to_jsonb(l) order by l.position, l.created_at) from my_lists l), '[]'::jsonb),
    'items', coalesce((select jsonb_agg(jsonb_build_object('list_id', i.list_id, 'book_id', i.book_id, 'position', i.position)
                                         order by i.list_id, i.position) from my_list_books i), '[]'::jsonb),
    'inbox', coalesce((select jsonb_agg(to_jsonb(n) order by n.created_at desc) from inbox_notes n), '[]'::jsonb),
    'next', coalesce((select jsonb_agg(jsonb_build_object('book_id', x.book_id, 'position', x.position)
                                        order by x.position, x.added_at) from next_books x), '[]'::jsonb),
    'takes', coalesce((select jsonb_agg(jsonb_build_object('book_id', t.book_id, 'body', t.body, 'updated_at', t.updated_at))
                         from book_takes t), '[]'::jsonb)
  );
end;
$$;

create or replace function create_list(p_code text, p_id text, p_name text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  perform require_code(p_code);
  insert into my_lists (id, name, position)
  select p_id, trim(p_name), coalesce(max(position), -1) + 1 from my_lists
  on conflict (id) do nothing;
end;
$$;

create or replace function rename_list(p_code text, p_id text, p_name text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  perform require_code(p_code);
  update my_lists set name = trim(p_name), updated_at = now() where id = p_id;
end;
$$;

-- Deleting a list never deletes books: only the list and which books were on it.
create or replace function delete_list(p_code text, p_id text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  perform require_code(p_code);
  delete from my_lists where id = p_id;
end;
$$;

create or replace function add_to_list(p_code text, p_list_id text, p_book_id text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  perform require_code(p_code);
  insert into my_list_books (list_id, book_id, position)
  select p_list_id, p_book_id, coalesce(max(position), -1) + 1 from my_list_books where list_id = p_list_id
  on conflict do nothing;
end;
$$;

-- Put many books on a list at once, after whatever is already on it, in the order given. A book that is
-- already on the list keeps its place; a book that doesn't exist is skipped.
create or replace function add_many_to_list(p_code text, p_list_id text, p_book_ids text[])
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  base int;
begin
  perform require_code(p_code);
  select coalesce(max(position), -1) + 1 into base from my_list_books where list_id = p_list_id;
  insert into my_list_books (list_id, book_id, position)
  select p_list_id, b.id, base + o.ord::int
    from unnest(p_book_ids) with ordinality as o(book_id, ord)
    join books b on b.id = o.book_id
  on conflict do nothing;
end;
$$;

create or replace function remove_from_list(p_code text, p_list_id text, p_book_id text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  perform require_code(p_code);
  delete from my_list_books where list_id = p_list_id and book_id = p_book_id;
end;
$$;

-- Put a list's books in this order (a list can be a queue). Books not named keep their place after these.
create or replace function reorder_list(p_code text, p_list_id text, p_book_ids text[])
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  perform require_code(p_code);
  update my_list_books m
     set position = o.ord - 1
    from unnest(p_book_ids) with ordinality as o(book_id, ord)
   where m.list_id = p_list_id and m.book_id = o.book_id;
  update my_list_books m
     set position = m.position + coalesce(array_length(p_book_ids, 1), 0)
   where m.list_id = p_list_id and not (m.book_id = any (p_book_ids));
end;
$$;

-- Save a draft exactly as typed. Its text is never changed afterwards.
create or replace function add_inbox_note(p_code text, p_id text, p_body text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  perform require_code(p_code);
  insert into inbox_notes (id, body) values (p_id, trim(p_body)) on conflict (id) do nothing;
end;
$$;

-- Mark a draft waiting, added (it became a book) or dismissed. Only the status changes.
create or replace function set_inbox_status(p_code text, p_id text, p_status text, p_book_id text default null)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  perform require_code(p_code);
  update inbox_notes
     set status = p_status, book_id = coalesce(p_book_id, book_id), updated_at = now()
   where id = p_id;
end;
$$;

/* ---------- private notes ---------- */

create or replace function list_notes(p_code text)
returns setof book_notes
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  perform require_code(p_code);
  return query select * from book_notes order by created_at;
end;
$$;

-- A new parameter list is a new function to Postgres, so the old ones are dropped first: two overloads
-- would be ambiguous through the REST interface.
drop function if exists add_note(text, text, text, text);
drop function if exists update_note(text, text, text);

create or replace function add_note(p_code text, p_id text, p_book_id text, p_body text, p_chapter text default null)
returns book_notes
language plpgsql
security definer
set search_path = public, extensions
as $$
declare saved book_notes;
begin
  perform require_code(p_code);
  insert into book_notes (id, book_id, body, chapter)
  values (p_id, p_book_id, trim(p_body), nullif(trim(coalesce(p_chapter, '')), ''))
  returning * into saved;
  return saved;
end;
$$;

-- No chapter given leaves the chapter as it was; a blank chapter clears it.
create or replace function update_note(p_code text, p_id text, p_body text, p_chapter text default null)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  perform require_code(p_code);
  update book_notes
     set body = trim(p_body),
         chapter = case when p_chapter is null then chapter else nullif(trim(p_chapter), '') end,
         updated_at = now()
   where id = p_id;
end;
$$;

create or replace function delete_note(p_code text, p_id text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  perform require_code(p_code);
  delete from book_notes where id = p_id;
end;
$$;

/* ---------- handy check after seeding ----------
select source, count(*) from book_sources group by source order by source;
-- Expect: Fantasy Top 100 UK 100, Man Book Club 165, NYT 50 Thrillers 124,
--         NYT Spy Novels 117, Tough Guy Book Club 100.
select count(*) from books;   -- Expect 586
*/
