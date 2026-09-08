-- OUR-126 Phase B bug fix: is_anonymous flips to false the moment an
-- anonymous user's email identity confirms, BEFORE any password is set --
-- confirmed live via auth.users.encrypted_password being empty right after
-- email confirmation. The client has no visibility into auth.users, so it
-- can't tell "confirmed but no password yet" from "fully signed in" on its
-- own. This function answers that directly, scoped to the caller's own row.
create or replace function public.mind_chess_needs_password()
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select coalesce(encrypted_password, '') = ''
  from auth.users
  where id = auth.uid();
$$;

grant execute on function public.mind_chess_needs_password() to authenticated;
