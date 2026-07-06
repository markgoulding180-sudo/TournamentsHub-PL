# GB Tournaments — Premier League Setup Guide

## The pattern, in one paragraph

One Supabase project (**PL-Master-Data**) holds nothing but Premier League
facts — teams, players, matches, current gameweek — synced from the official
FPL API. Every PL tournament (Predictions, Fantasy Manager, and any future
one) is its **own separate Vercel project + own separate Supabase project**
for its users/tournament-specific data, but all of them read the *same*
master project for teams/players/matches. Nothing about the master data is
duplicated by hand — it's synced once, read everywhere.

This is deliberately proven out on free accounts first. Every tournament app
already reads its master data through **its own env vars**
(`MASTER_SUPABASE_URL` / `MASTER_SUPABASE_SERVICE_KEY` /
`MASTER_SUPABASE_ANON_KEY`), separate from its own local
(`SUPABASE_URL` / `SUPABASE_KEY` / `SUPABASE_SECRET`) env vars. That means
moving to a paid plan later, or consolidating multiple projects into one,
is just changing which URL/key those two sets of env vars point to —
**no code changes required.**

## Today's setup (free tier, proving the concept)

```
┌─────────────────────┐
│   PL-Master-Data     │   ← ONE new Supabase project you create
│   (Supabase project) │      teams / players / matches / master_clock
└──────────┬───────────┘
           │  read via MASTER_SUPABASE_URL / MASTER_SUPABASE_*_KEY
   ┌───────┴────────┐
   │                │
┌──▼──────────┐  ┌──▼──────────────┐
│ Predictions │  │ Fantasy Manager │   ← separate Vercel projects,
│ (Vercel +   │  │ (same repo/     │      separate Supabase projects,
│  Supabase)  │  │  Vercel proj.   │      each with its OWN users/
└─────────────┘  │  as Predictions)│      tournaments/entries tables
                  └─────────────────┘
```

Right now, Fantasy Manager's pages live inside the same
`TournamentsHub-PL` repo/Vercel project as Predictions (so login is shared
between those two without needing a domain yet). Predictions and Fantasy
Manager still have their own local Supabase tables for users/predictions/
tournament_entries — only the PL facts (teams/players/matches/gameweek)
come from the master project.

## Step 1 — Create the master project

1. In Supabase, create a new project. Call it something unambiguous, e.g.
   **`PL-Master-Data`**.
2. Run `master-db-schema.sql` (included) in its SQL editor. This creates
   `teams`, `players`, `matches`, `master_clock`, and a `player_injuries`
   view — nothing else.
3. Grab three things from Supabase → Project Settings → API:
   - Project URL
   - `anon` `public` key
   - `service_role` `secret` key

## Step 2 — Point the existing PL app at it

In your `TournamentsHub-PL` Vercel project → Settings → Environment
Variables, add:

| Variable | Value |
|---|---|
| `MASTER_SUPABASE_URL` | the new project's URL |
| `MASTER_SUPABASE_SERVICE_KEY` | the new project's `service_role` key |
| `MASTER_SUPABASE_ANON_KEY` | the new project's `anon` key |

Your existing `SUPABASE_URL` / `SUPABASE_KEY` / `SUPABASE_SECRET` stay
exactly as they are — those still point at the PL app's own Supabase
project for users/predictions/tournaments/tournament_entries.

## Step 3 — Migrate the data once

Your current `players`/`teams`/`matches`/`master_clock` tables in the old
(local) project can just be **left in place and ignored** — or dropped
later once you trust the new setup. To populate the new master project:

1. Hit `/api/sync-players` once (syncs teams+players from FPL into master).
2. Hit `/api/sync-fixtures` once (syncs matches into master).
3. Hit `/api/current-gameweek` with `action: init` to set the master clock
   (see `api/current-gameweek.js` for the exact POST body shape).

No manual data copying needed — everything master-side is just re-synced
fresh from the FPL API, since that's what it always was anyway.

## The repeatable process for every new PL tournament from here on

1. **Decide: does it need its own Vercel project, or can it live as a page
   inside an existing one?** Rule of thumb: if it needs its own login
   flow or its own domain-worthy identity later, own project. If it's
   another football format that can share the Predictions app's users
   table for now (like Fantasy Manager), same project is fine short-term.
2. **New Supabase project** for that tournament's own tables (users if
   standalone, tournament_entries, whatever's tournament-specific).
   **Never** put `teams`/`players`/`matches` tables in it — those only
   ever live in `PL-Master-Data`.
3. **Set both sets of env vars** in that Vercel project: its own
   `SUPABASE_URL`/`KEY`/`SECRET`, plus the *same*
   `MASTER_SUPABASE_URL`/`SERVICE_KEY`/`ANON_KEY` as every other PL
   tournament.
4. **In code**, any query touching teams/players/matches/master_clock uses
   the master client; everything else uses the local client. That's the
   entire rule — see `api/tournaments.js` or `api/predictions.js` in this
   repo for the pattern to copy.
5. **Never join across the two** in a single Supabase query (e.g.
   `.select('*, matches:match_id(...)')`) — master and local are different
   Postgres databases, so a nested/joined select across them will not
   work. Always fetch from each client separately and match up the results
   in JavaScript (see `getTrendsData` in `api/predictions.js` for an
   example of this pattern).

## When you're ready to consolidate onto a paid plan

Nothing about the code changes. You'd either:
- keep the master project as-is and just upgrade it to Supabase Pro, or
- fold multiple tournament-specific Supabase projects together if you want
  fewer databases to manage,

and either way it's an env-var change in Vercel per project, not a rewrite.
