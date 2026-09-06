-- Applied 2026-09-06 to project lqwssctnvgpxnerahnkc (same project as
-- mind_chess_games and mind_chess_reports).
--
-- In-game chat for online mode (OUR-97). Read policy mirrors
-- mind_chess_games' own "Anyone can read mind chess games" policy — the
-- game id is already the whole security boundary for that table (an
-- unguessable UUID, not a public listing), so a chat row tied to that id
-- is no more exposed than the pgn already sitting in the same row. Write
-- is restricted to the two players seated in that specific game, mirroring
-- mind_chess_games' own UPDATE policy — a spectator can read the game
-- (and therefore the chat) but cannot post into it.

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

-- mind_chess_games is already in this publication (that's what makes its
-- own postgres_changes subscription in subscribeOnline() work) — chat
-- needs the same membership for its own INSERT subscription to fire.
-- Without this the feature still works via pollOnlineChat()'s 2s fallback,
-- just without the realtime push.
alter publication supabase_realtime add table public.mind_chess_chat;
