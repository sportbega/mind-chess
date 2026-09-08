-- Initial schema for Mind Chess's own split-off Supabase project
-- (qkchrdzgkcvowwttxtqu), created because the previous project
-- (lqwssctnvgpxnerahnkc) is shared with Giga Chess's chess_games table and
-- auth pool -- real accounts (Phase B/C of the accounts initiative) make
-- that sharing a much bigger commitment than sharing a few anonymous
-- session rows ever was. This file consolidates what the old project had
-- built up across five separate migrations (20260822_create_mind_chess_
-- reports, 20260906_create_mind_chess_chat, 20260906_create_mind_chess_
-- results, 20260906_mind_chess_results_update_policy, 20260906_add_clock_
-- increment, plus mind_chess_games itself which predates the migration-file
-- convention and was never captured in one) into a single from-scratch
-- creation, not an organic history -- there is deliberately no equivalent
-- append-only trail of small changes here, because none of them actually
-- happened against this project.
--
-- The old project is left untouched -- nothing here deletes or reads from
-- it. Its rows (3 mind_chess_results, 2 mind_chess_games, 26 mind_chess_
-- reports at the time of this migration) simply stop being the live app's
-- backend; they remain exactly where they are, just disconnected once
-- supabase-config.js points here instead.

-- ===================================================================
-- mind_chess_games (online mode, OUR-97) -- unchanged shape from the old
-- project, RLS and all.
-- ===================================================================
create table public.mind_chess_games (
  id uuid primary key default gen_random_uuid(),
  white_id uuid not null,
  black_id uuid,
  pgn text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  clock_preset integer not null default 0,
  white_ms integer not null default 0,
  black_ms integer not null default 0,
  last_move_at timestamptz not null default now(),
  clock_increment integer not null default 0
);

alter table public.mind_chess_games enable row level security;

create policy "Anyone can read mind chess games"
  on public.mind_chess_games
  for select to public
  using (true);

create policy "Creator can create a mind chess game"
  on public.mind_chess_games
  for insert to public
  with check (auth.uid() = white_id);

create policy "Players can update their mind chess game"
  on public.mind_chess_games
  for update to public
  using (auth.uid() = white_id or auth.uid() = black_id)
  with check (auth.uid() = white_id or auth.uid() = black_id);

alter publication supabase_realtime add table public.mind_chess_games;

-- join_mind_chess_game: SECURITY DEFINER so the joining player's UPDATE can
-- clear black_id atomically without a client-side read-then-write race
-- letting two joiners both think they got the seat. Unchanged from the old
-- project.
create or replace function public.join_mind_chess_game(game_id uuid)
returns public.mind_chess_games
language plpgsql
security definer
set search_path to 'public'
as $function$
declare game public.mind_chess_games;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  update public.mind_chess_games set black_id = auth.uid(), updated_at = now()
    where id = game_id and black_id is null and white_id <> auth.uid()
    returning * into game;
  if game.id is null then
    select * into game from public.mind_chess_games where id = game_id;
  end if;
  if game.id is null or auth.uid() not in (game.white_id, game.black_id) then
    raise exception 'This game is unavailable';
  end if;
  return game;
end;
$function$;

-- ===================================================================
-- mind_chess_chat (OUR-97) -- unchanged shape.
-- ===================================================================
create table public.mind_chess_chat (
  id bigint generated always as identity primary key,
  game_id uuid not null references public.mind_chess_games(id) on delete cascade,
  sender_id uuid not null,
  color text not null check (color in ('w','b')),
  body text not null check (char_length(body) between 1 and 500),
  created_at timestamptz not null default now()
);

alter table public.mind_chess_chat enable row level security;

create policy mind_chess_chat_select
  on public.mind_chess_chat
  for select to public
  using (true);

create policy mind_chess_chat_insert
  on public.mind_chess_chat
  for insert to public
  with check (
    sender_id = auth.uid()
    and exists (
      select 1 from public.mind_chess_games g
      where g.id = game_id
        and (g.white_id = auth.uid() or g.black_id = auth.uid())
    )
  );

create index mind_chess_chat_game_id_idx
  on public.mind_chess_chat (game_id, created_at);

alter publication supabase_realtime add table public.mind_chess_chat;

-- ===================================================================
-- mind_chess_reports -- unchanged shape.
-- ===================================================================
create table public.mind_chess_reports (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  build text,
  url text,
  agent text,
  note text,
  report text not null
);

alter table public.mind_chess_reports enable row level security;

create policy mind_chess_reports_insert
  on public.mind_chess_reports
  for insert to anon, authenticated
  with check (
    report like '=== Mind Chess problem report ===%'
    and char_length(report) between 200 and 300000
    and char_length(coalesce(note, '')) <= 4000
  );

create index mind_chess_reports_created_at_idx
  on public.mind_chess_reports (created_at desc);

-- ===================================================================
-- mind_chess_results -- Phase A's unified stats model. Real change from
-- the old project, not a copy: previously online/lichess only, personal
-- (win/loss/draw relative to `color`, always 'w' or 'b'). Computer and
-- two-player now write here too instead of localStorage-only (OUR-114/115).
--
-- The actual design decision, not hand-waved: two-player has no personal
-- seat -- pass-and-play on one device means there's no "you" to score a
-- win or loss against, which is exactly why the local-only version stored
-- the raw winning side ('white'/'black'/'draw') instead of a personalized
-- result. Rather than widen `color` to be nullable or widen `result` to
-- carry a second, differently-shaped vocabulary just for one mode, two-
-- player rows are written under a fixed convention: color is always 'w',
-- and result means "did White win" -- 'win' if White won, 'loss' if Black
-- won, 'draw' for a draw. This is a *recording* convention, not a claim
-- that White has a "personal" seat; the app's own rendering already
-- special-cases mode='two-player' to show White/Black wins instead of
-- Won/Lost (renderStatsTable() in index.html), so this is the read side
-- meeting a write side that already existed, not new UI. No widening of
-- the color or result CHECK constraints was needed at all -- only `mode`,
-- to admit the two local modes, and a new `level` column so computer
-- mode's per-rung breakdown (Statistics' "By level" table) survives the
-- move out of localStorage.
-- client_key: idempotency guard for EVERY insert, not just backfilled
-- rows -- per Phase A's explicit "can't double-count if it runs more than
-- once" requirement for the backfill, extended to live inserts too once
-- the mechanics were worked out. A one-time flag (localStorage, "have I
-- backfilled") can't actually guarantee that on its own -- it can run
-- again from a second browser signed into the same claimed account, after
-- the flag storage is cleared, or after a bug in a future edit to the
-- backfill code -- so the guarantee lives in the database instead: every
-- row's client_key is a deterministic string derived from the source game
-- (mode+endedAt+pgn), and app code always calls .upsert(row,
-- {onConflict:'user_id,client_key', ignoreDuplicates:true}), which
-- PostgREST turns into a plain `ON CONFLICT (user_id, client_key) DO
-- NOTHING`. That specifically requires client_key to be NOT NULL with a
-- non-partial unique index -- Postgres only infers a conflict target
-- against a *partial* index when the WHERE predicate is repeated in the ON
-- CONFLICT clause itself, which PostgREST never does, so a nullable/
-- partial version of this (tried first, corrected before any real data
-- existed) would have silently failed to dedupe or errored outright. One
-- side effect worth having anyway: a live game-end insert now gets the
-- same accidental-double-fire protection the backfill needed, for free,
-- from the same mechanism.
create table public.mind_chess_results (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id),
  mode text not null check (mode in ('online','lichess','computer','two-player')),
  color text not null check (color in ('w','b')),
  result text not null check (result in ('win','loss','draw')),
  level text,
  opponent text,
  pgn text not null default '',
  eco text,
  opening_name text,
  accuracy numeric,
  client_key text not null,
  created_at timestamptz not null default now()
);

create unique index mind_chess_results_user_client_key_idx
  on public.mind_chess_results (user_id, client_key);

alter table public.mind_chess_results enable row level security;

create policy mind_chess_results_insert
  on public.mind_chess_results
  for insert to authenticated
  with check (user_id = auth.uid());

create policy mind_chess_results_select
  on public.mind_chess_results
  for select to authenticated
  using (user_id = auth.uid());

create policy mind_chess_results_update
  on public.mind_chess_results
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create index mind_chess_results_user_id_idx
  on public.mind_chess_results (user_id, created_at desc);
