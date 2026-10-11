-- Book Archive: database setup.
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

create index if not exists books_status_idx on books (status);
create index if not exists book_sources_source_idx on book_sources (source);
create index if not exists book_notes_book_idx on book_notes (book_id);

/* ---------- who can read ---------- */

alter table app_secret enable row level security;   -- no policy: nobody can read it
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
  delete from login_failures;
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

create or replace function add_note(p_code text, p_id text, p_book_id text, p_body text)
returns book_notes
language plpgsql
security definer
set search_path = public, extensions
as $$
declare saved book_notes;
begin
  perform require_code(p_code);
  insert into book_notes (id, book_id, body) values (p_id, p_book_id, trim(p_body))
  returning * into saved;
  return saved;
end;
$$;

create or replace function update_note(p_code text, p_id text, p_body text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  perform require_code(p_code);
  update book_notes set body = trim(p_body), updated_at = now() where id = p_id;
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
