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
    Observation pods: two more pods off Balcony 2 (17 m, the Observation Deck; balcony 1 is the Recreation Deck) on the X axis,
    each with a second window in place of its engine, couches facing both windows, with corridors and DOCK
    Arcade: a small pod (the kit at 0.4) off the Recreation Deck (balcony 1) at Blender 18.5 degrees (across the hub
    from Terra), under an observation pod, with an ARCADE sign and seven cabinets (`src/arcade/arcade.ts`;
    `tools/build_arcade_cabinet.py`), attract-mode screens. VOID RACER (`src/arcade/racer/`, a pseudo-3D racer), ORBIT BLASTER (`src/arcade/orbit/`, an orbital defence
    shooter), STAR DRIFT (`src/arcade/drift/`, a lander), COMET RUN (`src/arcade/comet/`, an asteroid-field dodger), NEBULA BREAKER (`src/arcade/breaker/`, a
    brick-breaker), ASTRO GARDEN (`src/arcade/garden/`, a vine-growing
    snake game) and PETAL INVADERS are playable, all run by
    `src/arcade/cabinet.ts` (session, keys, sounds, per-station high scores). PETAL INVADERS (`src/arcade/invaders/`: `game.ts` pure rules, `play.ts`
    controls/sounds/station high score synced per station, `hud.tsx` the screen; sounds from
    `tools/make_arcade_sounds.py`).
    Terra, the Earth room: a 0.6-scale pod off the Recreation Deck at Blender 201 degrees (clear of the -X
    observation pod sideways), dressed as a park (`src/terra/terra.ts`; `tools/build_terra.py` builds terra.glb with
    generated sky/hills/grass textures; `tools/make_terra_ambience.py` the birdsong loop): sittable benches,
    butterflies, a warm light, ambience fading with distance.
    Breeding lab: a 0.6-scale pod off the Docks at Blender 169.5 (between the hub benches, under the -X observation
    pod), built but sealed by a door at the hub end (`sealed_door`), with a LAB sign and `src/lab/lab.ts`'s lettering.
    To open it later: drop the `sealed_door` part and its lettering.
    Fuel cell dispensers: the landing build's vending machine and its panel (`src/fuel/`: giveaway, MANA store,
    code redemption, operator on/off), copied unchanged but for import paths (it shares the station's `auth.ts`);
    one machine in the hub's desk ring at 270°, opposite the trading post, at 1.5x (`src/fuel/vending.ts`).
    Visitors with no captain get a welcome banner pointing them to the ship world (`gate.ts`, `ui.tsx`).
    signs like the lower four. Observation Deck (balcony 1): the ship's 3D galaxy map with the social heat map, turning over the atrium
    (`src/observation/galaxyHologram.ts`; `galaxyMap.ts`, `heatMap.ts`, `prefs.ts` copied unchanged). The
    lifts (`src/lift/`: a physical platform in a vertical shaft on each end of the X axis, run as elevators. A HUD
    floor panel (click, or keys 1-4) while aboard, up/down call buttons at each landing, gates while the car is
    elsewhere. Collective dispatching in `controller.ts` (pure, tested); state synced per station under network ids
    hashed from the station id, so each station's players share their own lifts), the lounge's dance floor, and Relay Radio
    (`src/lounge/music.ts`, fading in with height). The game's soundtrack (`src/soundtrack.ts`, copied from the ship
    with one addition, `setSoundtrackFade`) plays the space-station theme everywhere else, fading out as the radio
    fades in; the ship's music bar (NEXT / MUTE) is in `src/ui.tsx`. Heights and the
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
  - Ship Services (every pod, `src/shipServices.ts`): the ship's two desks: the ship desk (Overview, Ship Systems,
    Pod Operations) and Flora Collections (Summary, Catalog, Vault, Inventory), either side of each pod's engine hatch,
    and the ship's 3D system map over the pod's projector. Every pod has the desk models; the one live pair, and the
    map, move to the pod the player is in (the copied code refreshes desks by id). Copied unchanged from
    `galaxy-gardeners-dcl` (`stations.ts`, `stations/*`, `api.ts`, `systemView.ts`, `countdown.ts`, `sfx.ts`,
    `payments.ts`, `types.ts`, `topViewHide.ts`, and assets). Keep them identical: re-copy rather than edit. Stand-ins
    for ship-only systems: `docking.ts`, `cabinDim.ts`, `soundtrack.ts`; the desk's HUD dialogs are lifted verbatim
    into `shipDialogs.tsx`. The station's own server calls are in `stationApi.ts`. Axis note: the explorer turns the
    kit's Blender axes half round (Blender +Y, the window, is scene -Z).
  - Trading Post (hub floor, `src/trading/`): BOARD (this station's offers; accept, choosing which of your specimens
    fill requests; cancel your own), POST OFFER, MY TRADES (open offers, history), GALLERY. Server: `routes/trades.ts`,
    with the trade logic in Postgres functions (`050_atomic_trades.sql`). Polls the board every 15 s while viewed.
  - Notice Board (hub floor, `src/board/`): the station's posts (pinned first) and replies, with reply, delete (own, or
    moderators), pin (moderators) and report. Typed in a HUD box (`compose.tsx`). Server: `routes/board.ts`,
    table `station_posts` (`051_station_posts.sql`). Polls every 20 s while viewed.
  - Hall of Records (hub floor, `src/records/`): galaxy leaderboards on a desk (rankings with category tabs; your
    standing below). Server: `routes/leaderboards.ts`,
    materialized view `leaderboard_stats` refreshed every 10 min (`052_leaderboards.sql`).
  - Lounge club: `src/lounge/` — Relay Radio (`music.ts`), a beat clock (`beatClock.ts`: AudioAnalysis on the
    stream when it reports bands, else rebel-radio's 124 BPM clock; `beat.ts` copied from rebel-radio), four moving
    spotlights with beams, a mirror ball throwing light specks and a kinetic chandelier (`clubLights.ts`;
    `tools/build_disco_ball.py`), the dance floor stepping on the beat, and the SPACE BAR neon sign
    (`spaceBarSign.ts`; `tools/build_space_bar_sign.py`) on the dome above the east lift. Below it, the bar (`src/lounge/spaceBar.ts`; `tools/build_space_bar.py`) with nine of The Silt's
    pedestal bar stools (cyan/magenta), sittable via `seating.ts`; the lounge bench at scene 240 was dropped for it.
  - Couches (`src/lounge/couches.ts`): rebel-radio's couch.glb and seat layout, with `seating.ts` copied unchanged
    (`descent.ts` is its stand-in): four in the lounge, a pair facing each window in both observation pods. Placeholders until
    the space couches arrive.
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

## Tests

- `npm test` runs vitest with the real @dcl/ecs engine headless in Node. The explorer-only `~system/*` modules resolve
  to stand-ins in `test/system/` (vitest.config.ts); `test/helpers.ts` steps the engine (`tick`) and counts entities.
- `npm run deploy` runs the tests first (`predeploy`): a failing test stops the deploy.
- The tests pin the explorer-load fixes of 2026-09-29 (lounge, Terra, arcade, lab, hub desks, gate, soundtrack,
  holograms): anything running every frame must not re-set materials, meshes or text every frame, and pollers keep
  one request in flight. Each test failed against the code before those fixes. Add a test with every change to a
  per-frame system or a poller.
- Module-level state (the gate, the soundtrack) is per test file: put tests that need a fresh module in their own
  file rather than using vi.resetModules (the engine would no longer be the one the test steps).

## Build and deploy

- Node 20 is required: `source ~/.nvm/nvm.sh && nvm use 20`, then `npm install` and `npm run build`.
- The SDK is pinned to 7.23.2, the ship scene's version. Newer `sdk-commands` (7.29) call `fs.globSync`,
  which needs Node 22, and fail on Node 20.
- Deploy: `npm run deploy -- --target-content https://worlds-content-server.decentraland.org`, signing with
  the MetaPetal wallet `0x7e56…374C`. That wallet must own `stellarstation.dcl.eth` (or be granted deploy
  permission) first.
- Last deployed 2026-09-29 from `fe3a671` (MANA payments without the chain-id check, the Space Bar's bartenders BETA and BLIP, drinks and their emotes, the
  hidden pod behind the back bar with the Eld relay and its music, the Crew panel, the club's lasers and
  frequency-driven lights, remembered mutes, and everything before). The signature must be made within 5 minutes of
  the signing page opening.
- The ship scene's `.editor/project.json` and its `scene.json` `source.projectId` belong to that project; don't
  copy them here. Creator Hub assigns this project its own on import.
