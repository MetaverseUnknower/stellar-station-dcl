# Stellar Station — features plan

Agreed 2026-09-26. Build in this order; each part ships on its own (server on a branch with tests, then the scene,
checked in preview before deploy).

## Layout: four themed wings
The pods become wings: **Ship Services**, **Trading Post**, **Notice Board**, **Hall of Records**, with leaderboard
screens on the hub floor too. Desks and screens are scene code at the pod positions (diagonals, POD_DISTANCE out).

## 1. Ship Services — Ship Systems (+ Overview), copied verbatim
- Copy unchanged from `galaxy-gardeners-dcl`: `src/stations/shipSystems.ts`, `src/stations/shipOverview.ts`,
  `src/stations.ts`, `src/stations/draw.ts`, `src/stations/data.ts`, `src/countdown.ts`, `src/topViewHide.ts`, the
  ship's `src/api.ts` (station calls added alongside), `nav_panel_high_1.glb` / `nav_panel_low_1.glb`, and the images
  and icons the views use.
- Shims only where the ship's code reaches into ship-only systems: `docking.ts` (always docked; the station's name,
  so installs are instant), `cabinDim.ts` (no-op). Plus whatever else shipOverview turns out to import.

## 2. Trading Post — specimen and resource trading (this station)
The server already has a station-scoped market (`routes/trades.ts`, `services/trade/tradeService.ts`): escrow,
species / min-rarity / open requests, 7-day expiry, history, station gallery, push.
- Scene desk views: Board (this station's offers), Offer detail + ACCEPT (choose samples to fulfil), Post offer
  (from cargo/vault; +/- quantity pickers), My offers (cancel), History, Gallery. Poll every 15 s while viewed.
- Server hardening first: batch the per-item queries on the list; atomic accept (Postgres function) so an offer can't
  be accepted twice; cargo and vault capacity checks on accept; **accept requires docking at the offer's station**
  (applies to the iOS app too); per-player rate limit.

## 3. Notice Board — message boards (this station)
- Server: `station_posts` (station, author, body ≤ 500, parent post for **one level of replies**, created, expires
  ~30 days, pinned, deleted). List (docked or admin), post / reply (docked, not timed out, profanity filter, ~5 per
  10 min), delete own / admin delete and pin, report via `player_reports`, hide blocked players' posts.
- Scene: large wall screen, pinned first, replies under their post; posting through a HUD text box (the ship's
  STEM chat input pattern), since the world has no text entry.

## 4. Hall of Records — leaderboards (per galaxy)
- Categories rankable today: species catalogued, first discoveries, systems discovered, expeditions, trades
  completed, stations founded. Distance travelled and lifetime resources aren't recorded yet.
- Server: per-galaxy stats materialized view refreshed every 10 min by pg_cron; indexes on
  `flora_species.discovered_by` and `star_systems.discovered_by`; `GET /api/leaderboards/:category` → top 20 + your
  rank.
- Scene: tall screens cycling categories with your row highlighted, in the Hall of Records and on the hub floor.
