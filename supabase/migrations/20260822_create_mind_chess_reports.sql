-- Applied 2026-08-22 to project lqwssctnvgpxnerahnkc (shared with Giga Chess;
-- own table, own policy, same convention as mind_chess_games).
--
-- Kept in the repo because the RLS shape below is the whole security story of
-- the Send button, and a policy that lives only in a dashboard is a policy
-- nobody can review.

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

-- Anyone playing may submit a report. NOBODY may read one back: the report
-- carries whatever the player typed into the "what went wrong" box, and a
-- public SELECT policy would put that in front of every other visitor.
-- Reading is done over an authenticated connection instead.
--
-- The `like` check is a cheap abuse filter: the table accepts things shaped
-- like reports and nothing else. Verified from the browser with the anon key —
-- select returns zero rows, delete and update affect none, and an insert of
-- "not a report" is refused by this policy.
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
