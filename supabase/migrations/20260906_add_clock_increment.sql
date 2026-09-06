-- Applied 2026-09-06 to project lqwssctnvgpxnerahnkc.
--
-- OUR-108: online mode's clock gains an increment (seconds, added to the
-- mover's own clock after each of their moves — see saveOnline() in
-- index.html), matching the same addition to the app's own internal clock
-- and to the Lichess seek panel's expanded time-control list. clock_preset
-- (minutes) already existed; this is its seconds-per-move counterpart.
-- Existing rows default to 0, which is exactly what a pre-migration game
-- with no increment concept at all should read as.

alter table public.mind_chess_games
  add column clock_increment integer not null default 0;
