-- Grand Slam of Darts: group stage support (applied to the main project 13 Oct 2026).
-- Additive only - existing knockout (World Grand Prix style) tournaments are unaffected.
alter table darts.players add column if not exists group_letter text;      -- 'A'..'P' for group-stage events
alter table darts.players add column if not exists group_position integer; -- real finish in the group (1, 2 or 3), set by admin
alter table darts.tournaments add column if not exists round_formats jsonb; -- {"3":16,"4":16,"5":16} = "first to" legs for score rounds

create table if not exists darts.group_predictions (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references darts.tournament_entries(id) on delete cascade,
  group_letter text not null,
  first_id uuid not null references darts.players(id),
  second_id uuid not null references darts.players(id),
  points_earned integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (entry_id, group_letter)
);
alter table darts.group_predictions enable row level security;
grant select, insert, update, delete on darts.group_predictions to service_role;

-- Grand Slam: players confirmed so far, shown on the tournament page until the
-- group draw is entered ([{ "name": "...", "via": "..." }]). Applied 14 Oct 2026.
alter table darts.tournaments add column if not exists qualified_players jsonb;
