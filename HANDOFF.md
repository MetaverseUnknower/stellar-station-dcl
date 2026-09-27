# Stellar Station — handoff

The Decentraland scene for the inside of a Galaxy Gardeners space station. Players come here from their ship
(the Galaxy Gardeners ship scene) while the ship is docked at a station.

- **World:** `stellarstation.dcl.eth` (set in `scene.json` → `worldConfiguration.name`)
- **Size:** 16 × 16 parcels (256 m square), the same as the ship scene. Spawn at the centre, (128, 0, 128).
- **State:** gating, audience filter, transfers and a first station layout are built.
  - `src/station.ts`: places `assets/models/station/station.glb` (deck at y 40, like the ship) inside the ship's
    skybox. Everyone spawns in a sealed black holding box under the hub (`scene.json`), and is moved into one of the four
    pods, fixed per wallet (`podForWallet`), once the gate clears them. A refused player stays in (or is returned
    to) the box while the gate sends them back to the ship. Anyone who falls through the hull goes back to their pod.
  - Hub levels: two ring balconies (9 m, 17 m) and a lounge (25 m) are in the model; `src/hubLevels.ts` adds the
    lift pads (cyan up, magenta down, on both ends of the X axis) and the lounge's dance floor. Heights and the
    lift radius must match `BALCONIES` / `LOUNGE` / `LIFT_R` in the build script.
  - `tools/build_station_models.py`: builds `station.glb` from
    `~/-MetaPetal/Daisy Class Assets/DaisyClass_Interior_Kit.blend` (read only, never saved): a 2x hub with four
    diagonal doors, a pod on each diagonal, corridors between them, benches in the hub. The whole layout is baked
    into one model around the hub centre, so it doesn't depend on how the explorer converts glTF axes. Rerun it
    after changing the kit or the layout constants at the top of the script (command in its header).
  - `src/gate.ts`: signs in, checks `/api/stations/status`, sends non-docked players to `galaxygardeners.dcl.eth`, re-checks every 30 s.
    Admins (`players.is_admin`) always get in and get an admin panel to switch to any station (server:
    `isAdmin` on `/status`, admin-only `GET /api/stations/list`, and wallets on `/docked` for admins).
  - `src/audience.ts`: one scene-wide `AvatarModifierArea` hiding every avatar but the wallets docked at the player's
    station (refreshed every 10 s). Needs the server's `walletAddress` on `/docked` (branch
    `feature/station-wallets`); without it, players see only themselves.
  - `src/ui.tsx`: status banner, docked crew list, RETURN TO SHIP. Voice chat is disabled in `scene.json`.
  - Ship Services (pod 0, `src/shipServices.ts`): the ship's two desks, set up as in the ship: the ship desk
    (Overview, Ship Systems, Pod Operations) and Flora Collections (Summary, Catalog, Vault, Inventory), copied unchanged from `galaxy-gardeners-dcl` (`stations.ts`, `stations/*`, `api.ts`, `countdown.ts`, `sfx.ts`,
    `payments.ts`, `types.ts`, `topViewHide.ts`, and assets). Keep them identical: re-copy rather than edit. Stand-ins
    for ship-only systems: `docking.ts`, `cabinDim.ts`, `soundtrack.ts`, `systemView.ts`; the desk's HUD dialogs are
    lifted verbatim into `shipDialogs.tsx`. The station's own server calls are in `stationApi.ts`.
  - Trading Post (pod 1, `src/trading/`): BOARD (this station's offers; accept, choosing which of your specimens
    fill requests; cancel your own), POST OFFER, MY TRADES (open offers, history), GALLERY. Server: `routes/trades.ts`,
    with the trade logic in Postgres functions (`050_atomic_trades.sql`). Polls the board every 15 s while viewed.
  - Notice Board (pod 2, `src/board/`): the station's posts (pinned first) and replies, with reply, delete (own, or
    moderators), pin (moderators) and report. Typed in a HUD box (`compose.tsx`). Server: `routes/board.ts`,
    table `station_posts` (`051_station_posts.sql`). Polls every 20 s while viewed.
  - Hall of Records (pod 3, `src/records/`): galaxy leaderboards on a desk (rankings with category tabs; your
    standing below) and on a double-sided board turning above the hub's projector. Server: `routes/leaderboards.ts`,
    materialized view `leaderboard_stats` refreshed every 10 min (`052_leaderboards.sql`).
  - Features plan (trading, message boards, leaderboards): `docs/station-features-plan.md` (all four parts built).
  - Ship: BOARD STATION on the nav console's station card while docked (`boardStation` in `src/docking.ts`).

## Requirements (from the product owner)

1. **Docked players only.** A player may be in this scene only while their ship is docked at a station.
2. **Per-station audience.** Everyone sees only the players docked at *their* station. Two players docked at
   different stations share the world but must not see each other.
3. **Transfer from the ship.** Players move here from the ship scene when docked (and back when they leave or undock).

## What already exists

**Ship scene** — `../galaxy-gardeners-dcl` (branch `feature/ship-stations`):
- `src/auth.ts`: wallet sign-in against the Galaxy Gardeners server (`/api/auth/dcl`); reuse it here so the
  station knows the player.
- `src/api.ts`: API client (`API_BASE`, bearer token). `src/uiScale.ts`: HUD scaling (author at 1080 px tall,
  `px()` scales to the canvas; use it for every 2D UI size).
- `src/docking.ts` / `src/navConsole.ts`: the DOCK / UNDOCK flow. The "go to the station" button belongs there.

**Server** — `galaxy-gardeners-server` (Express + Supabase on Railway; push to `main` deploys production):
- `GET /api/stations/status` → `{ isDocked, stationId }` for the signed-in player. This is the entry check.
- `GET /api/stations/docked/:stationId` → `[{ playerId, username, dockedAt }]`, players docked at a station.
  It has **no wallet addresses**; the visibility filter below needs them. Decentraland players' auth emails
  are `<wallet lowercase>@dcl.galaxy-gardeners.app` (`src/routes/authDcl.ts`), so a server change can add
  `walletAddress` for DCL players.
- `POST /api/stations/undock`, station chat (`/api/stations/chat/:stationId`).
- Docking is stored in the `station_docking` table (one row per docked player).

## Platform limits to design around

- **A world can't refuse entry.** The scene must enforce requirement 1 itself: sign in, call
  `/api/stations/status`, and if the player isn't docked, send them back to the ship world
  (`changeRealm` from `~system/RestrictedActions`) with a short explanation. Re-check periodically, since a
  player can undock from the iOS app while standing here.
- **Everyone in a world shares one comms room.** Hiding other stations' players is a scene-side effect: an
  `AvatarModifierArea` covering the whole scene with `HIDE_AVATARS` and `excludeIds` set to the wallets docked
  at the player's station (refreshed as players dock and undock). Proximity voice and world text chat are
  **not** filtered by this; decide whether to accept that or disable voice in `scene.json`.
- **Transfers.** `changeRealm` to `stellarstation.dcl.eth` from the ship (and to `galaxygardeners.dcl.eth` back).
  The explorer asks the player to confirm. The station scene learns which station from `/api/stations/status`,
  so nothing needs to travel in the URL.

## Build and deploy

- Node 20 is required: `source ~/.nvm/nvm.sh && nvm use 20`, then `npm install` and `npm run build`.
- The SDK is pinned to 7.23.2, the ship scene's version. Newer `sdk-commands` (7.29) call `fs.globSync`,
  which needs Node 22, and fail on Node 20.
- Deploy: `npm run deploy -- --target-content https://worlds-content-server.decentraland.org`, signing with
  the MetaPetal wallet `0x7e56…374C`. That wallet must own `stellarstation.dcl.eth` (or be granted deploy
  permission) first.
- The ship scene's `.editor/project.json` and its `scene.json` `source.projectId` belong to that project; don't
  copy them here. Creator Hub assigns this project its own on import.
