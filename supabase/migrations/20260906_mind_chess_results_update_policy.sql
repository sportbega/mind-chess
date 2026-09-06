-- Applied 2026-09-06 to project lqwssctnvgpxnerahnkc.
--
-- OUR-116: Game review patches its own computed accuracy back onto the
-- row OUR-114's onGameEnd() already inserted for online/Lichess games —
-- found missing by testing the actual update, not by reading the
-- original migration and assuming insert+select was enough. Same
-- ownership boundary as the other two policies: a player may only ever
-- touch their own rows.
create policy mind_chess_results_update
  on public.mind_chess_results
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
