-- Sets (or changes) the passcode that protects adding and editing.
-- 1. In the one line below, replace the text between the single quotes with your own passcode.
-- 2. Paste into the Supabase SQL editor and run it.
-- 3. Do not save or commit this file with your real passcode in it. The passcode is stored
--    scrambled (hashed), so nobody can read it back, but the file itself would show it.
insert into app_secret (id, passcode_hash)
values (true, extensions.crypt('CHOOSE-A-PASSCODE', extensions.gen_salt('bf')))
on conflict (id) do update set passcode_hash = excluded.passcode_hash;
-- Changing the passcode signs every device out and clears any lockout.
delete from app_sessions;
delete from login_failures;
