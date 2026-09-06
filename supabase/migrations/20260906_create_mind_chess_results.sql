-- Applied 2026-09-06 to project lqwssctnvgpxnerahnkc (same project as
-- mind_chess_games/chat/reports).
--
-- Stats (OUR-115/116): local modes (computer/two-player/puzzle) keep their
-- result log entirely in localStorage, matching every other per-browser
-- setting this app already has. Online and Lichess are different — a
-- player who plays those modes across visits already has a stable identity
-- (the anonymous Supabase session signInAnonymously() already creates for
-- online mode; Lichess mode reuses it too, see ensureOnlineUser() call
-- added alongside this table) that a local-only log can't offer anything
-- over, so those two modes mirror their result here instead.
--
-- Unlike mind_chess_games/chat (an unguessable game id IS the security
-- boundary, so "anyone can read" is fine), this is a player's own stats
-- history — private by default, unlike anything else in this schema.
create table public.mind_chess_results (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id),
  mode text not null check (mode in ('online','lichess')),
  color text not null check (color in ('w','b')),
  result text not null check (result in ('win','loss','draw')),
  opponent text,
  pgn text not null default '',
  eco text,
  opening_name text,
  accuracy numeric,
  created_at timestamptz not null default now()
);

alter table public.mind_chess_results enable row level security;

create policy mind_chess_results_insert
  on public.mind_chess_results
  for insert to authenticated
  with check (user_id = auth.uid());

create policy mind_chess_results_select
  on public.mind_chess_results
  for select to authenticated
  using (user_id = auth.uid());

create index mind_chess_results_user_id_idx
  on public.mind_chess_results (user_id, created_at desc);
