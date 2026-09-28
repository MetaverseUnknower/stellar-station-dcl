# The Black Market — plan

A sketchy terminal in a dim back room behind the Space Bar where players pay MANA (Polygon) for questionably ethical
favours. Every purchase goes through the server's existing MANA verification, the same as the fuel cell store, and
its effect is applied by the server. The terminal only lets players choose items and pay.

## What it sells (proposed prices, MANA)

| Item | Effect | Price |
|---|---|---|
| Public wormhole, 1 h / 3 h / 6 h | A wormhole to a star system of the buyer's choice, open to everyone in the galaxy (the existing wormhole events, bought instead of admin-made), announced by push | 50 / 120 / 200 |
| Exclusive wormhole, 1 h / 3 h / 6 h | The same, but only the buyer and the friends they pick can jump | 100 / 240 / 400 |
| Star destruction | A star system becomes a supernova remnant: shown dead on the maps, no travel to it, no flora. Nothing is deleted (reversible by an admin). Refused if it has a station, is anyone's home, anyone is there, or pods are out there | 150 |
| Star naming rights | Rename a star system (the station-name rules: letters, numbers, spaces, 30 max, profanity filter). Once per system | 40 |
| Cloaking device | Hidden from the heat map and the leaderboards for 24 h | 25 |
| Pirate radio slot | Your message (filtered, 80 max) scrolls on every station's welcome sign for 1 h, queued if another is on air | 30 |
| Pod insurance | Your pods survive the next wormhole that closes on them (one use, 30 days) | 20 |

## Server (galaxy-gardeners-server)

1. **Migration 060** `black_market`:
   - `black_market_purchases`: tx_hash UNIQUE, player, item, params, status, applied_at, error, refundable.
   - `star_systems.remnant_at` and `remnant_by`, `star_systems.renamed_by`.
   - `wormhole_events.exclusive` and `wormhole_events.bought_by`, plus `wormhole_event_guests`.
   - `cloaks (player_id, until)`, `radio_broadcasts (message, player, starts_at, ends_at)`, `pod_insurance (player_id, expires_at, used_at)`.
   - An `apply_*` function per item where atomicity matters, in particular the star-destruction eligibility check and the
     remnant mark in one statement.
2. **Payments.** `POST /api/black-market/buy` takes { item, params, txHash }. It reuses `verifyManaPayment` and the
   pending/202 flow from the fuel store (`store.ts` 161-257; the tx_hash is unique across both tables). Params are
   validated *before* payment by `POST /api/black-market/quote`, so a player can't pay for an effect that will be refused.
   If an effect still fails after payment, the purchase is marked refundable for an admin.
3. **Effects:**
   - **Wormholes.** `wormhole_events` rows are created with `created_by` = buyer. The existing overlap check keeps one
     event per galaxy at a time, so a purchase finds the next free window. `canJump` (`wormholeRules.ts:12`) also checks
     `exclusive` against the guest list.
   - **Remnants.** Travel (`travel.ts` `calculateFuelCost`) refuses remnant destinations. The system detail and planets
     routes return `remnant: true`, and planets and flora come back empty.
   - **Rename.** Updates `star_systems.name`, validated like `validateStationName`.
   - **Cloak.** The population query (`systems.ts:17-22`) and `topLists` (`leaderboards.ts:31`) skip players with an
     active cloak.
   - **Radio.** The system detail response (`systems.ts:139`) and `GET /api/black-market/radio` give the message on air.
   - **Insurance.** `closeEvent`'s loop (`wormhole.ts:131-135`) spares an insured player's pods and uses up the policy.
4. **Admin.** List purchases, refund-flag, and undo a remnant or a rename.
5. **Tests.** pgTAP for the migration and functions, and route tests for quote, buy, pending, each effect and the refusals.

## Station scene (stellar-station-dcl)

1. **The back room.** A small dim alcove behind the Space Bar's back cabinet: a gap in the wall, a flickering neon,
   and a grimy terminal (a new Blender model: a cabinet with a cracked screen and a hand-lettered "NO REFUNDS" sticker).
2. **The terminal's panel.** A shady-themed HUD with the item list, each item's parameters (star picker via the
   galaxy's systems, wormhole length, friends for an exclusive one, a message, a new name), a quote, then pay (the
   landing build's `payMana`, already in `src/fuel/payments.ts`), then waiting for Polygon, then done or failed.
3. **Radio on the welcome signs.** A scrolling marquee line under "Ships Docked" when a broadcast is on air.

## Elsewhere (to check or follow up)

- **The ship scene and the iOS app** should show remnants as dead stars and could show a cloak; until they're updated,
  a remnant still looks normal there but can't be travelled to (the server refuses it).
- **Legal.** Wormholes, renames and radio are user-generated and public: they need the existing reporting and moderation.
