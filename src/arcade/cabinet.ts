// What every playable arcade cabinet shares: stepping up to it, the controls, the sounds, and the station's high
// score table for each game.
//
// Playing freezes the avatar (InputModifier), so the movement keys steer the game instead of the player. The keys a
// game can read: the arrows / WASD (the explorer's movement actions), 1-4 as a fallback (in case the explorer keeps
// movement to itself while frozen), E or Space to act and start, F to walk away. Walking away (or being moved off,
// e.g. teleported) ends the session.
//
// High scores belong to the station: synced between the players docked there, and only them, under a network id from
// the station's id and the game (as the lifts do, lift/lifts.ts).
import { engine, Entity, Transform, InputModifier, inputSystem, InputAction, PointerEventType, AudioSource, Schemas } from '@dcl/sdk/ecs'
import { Vector3 } from '@dcl/sdk/math'
import { syncEntity } from '@dcl/sdk/network'
import { getPlayer } from '@dcl/sdk/players'
import { movePlayerTo } from '~system/RestrictedActions'
import { onGateChanged, getGateState, GateState } from '../gate'

const LEAVE_DISTANCE = 3 // metres from where the game put the player: past this, the session ends
const SOUND_VOLUME = 0.55

/** The controls this frame, as a game reads them. */
export type Keys = {
  up: boolean; down: boolean; left: boolean; right: boolean // held
  upPressed: boolean; downPressed: boolean; leftPressed: boolean; rightPressed: boolean // just pressed
  act: boolean // E / Space held
  actPressed: boolean // just pressed
}

/** A game the cabinet can run. */
export type CabinetGame = {
  id: string // for its high score table ('invaders', 'garden', ...)
  /** A fresh session (the title screen). */
  begin(): void
  /** Advance; returns the sound clips (file names under assets/audio/arcade, without .wav) to play. */
  tick(keys: Keys, dt: number): string[]
  /** The score of the game in progress or just ended; and whether it has ended (then it's offered as a record). */
  score(): number
  over(): boolean
}

let active: CabinetGame | null = null
let standAt: Vector3 | null = null
let submitted = false
const bests = new Map<string, number>()

export const playingGame = (): string | null => active?.id ?? null
export const personalBest = (id: string) => bests.get(id) ?? 0

/** Step up to a cabinet: stand at `front`, looking at `screen`, with the avatar frozen, and start `game`. */
export function play(game: CabinetGame, front: Vector3, screen: Vector3): void {
  if (active) return
  movePlayerTo({ newRelativePosition: front, cameraTarget: screen })
  InputModifier.createOrReplace(engine.PlayerEntity, { mode: InputModifier.Mode.Standard({ disableAll: true }) })
  standAt = front
  active = game
  submitted = false
  game.begin()
}

export function leave(): void {
  if (!active) return
  offer(active)
  active = null
  standAt = null
  InputModifier.deleteFrom(engine.PlayerEntity)
}

// ---- high scores ---------------------------------------------------------------------------------------------------

const HiScore = engine.defineComponent('stellar::ArcadeHiScore', { game: Schemas.String, score: Schemas.Int, name: Schemas.String })
const GAMES = ['invaders', 'garden', 'breaker'] // each game's table has its own network id: keep this order, add at the end
const tables = new Map<string, Entity>()

function syncId(stationId: string, game: string): number {
  let h = 0x811c9dc5
  for (const ch of stationId) {
    h ^= ch.charCodeAt(0)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return 780000 + (h % 10000) * 4 + Math.max(0, GAMES.indexOf(game)) // clear of the lifts' 720000..760000
}

function useStation(stationId: string | null): void {
  for (const game of GAMES) {
    const e = engine.addEntity()
    HiScore.create(e, { game, score: 0, name: '' })
    if (stationId) syncEntity(e, [HiScore.componentId], syncId(stationId, game))
    tables.set(game, e)
  }
}

/** A game's high score at this station (0 and '' until someone sets one). */
export function stationHiScore(game: string): { score: number; name: string } {
  const e = tables.get(game)
  const h = e ? HiScore.getOrNull(e) : null
  return h ? { score: h.score, name: h.name } : { score: 0, name: '' }
}

/** Record a finished game's score: a personal best, and the station's high score if it beats it. */
function offer(game: CabinetGame): void {
  const score = game.score()
  if (submitted || score <= 0) return
  submitted = true
  bests.set(game.id, Math.max(personalBest(game.id), score))
  const e = tables.get(game.id)
  if (e && score > stationHiScore(game.id).score) {
    const name = (getPlayer()?.name || 'GARDENER').slice(0, 14).toUpperCase()
    HiScore.createOrReplace(e, { game: game.id, score, name })
  }
}

// ---- sounds --------------------------------------------------------------------------------------------------------

const speakers: Entity[] = []
let nextSpeaker = 0

function sound(clip: string): void {
  if (speakers.length === 0) for (let i = 0; i < 6; i++) speakers.push(engine.addEntity())
  // A few speakers in turn, so one sound doesn't cut off another; replacing the component restarts a clip.
  const speaker = speakers[nextSpeaker++ % speakers.length]
  AudioSource.createOrReplace(speaker, { audioClipUrl: `assets/audio/arcade/${clip}.wav`, playing: true, loop: false, volume: SOUND_VOLUME, global: true })
}

// ---- running -------------------------------------------------------------------------------------------------------

export function setupCabinets(): void {
  let station: string | null = null
  const onGate = (gate: GateState) => {
    const next = gate.kind === 'aboard' ? gate.stationId : null
    if (next !== station || tables.size === 0) {
      station = next
      useStation(station)
    }
  }
  onGateChanged(onGate)
  onGate(getGateState())

  const held = (...keys: InputAction[]) => keys.some((k) => inputSystem.isPressed(k))
  const pressed = (...keys: InputAction[]) => keys.some((k) => inputSystem.isTriggered(k, PointerEventType.PET_DOWN))
  engine.addSystem((dt) => {
    if (!active) return
    if (pressed(InputAction.IA_SECONDARY)) {
      leave()
      return
    }
    const me = Transform.getOrNull(engine.PlayerEntity)
    if (me && standAt && Vector3.distance(me.position, standAt) > LEAVE_DISTANCE) {
      leave()
      return
    }
    const keys: Keys = {
      up: held(InputAction.IA_FORWARD, InputAction.IA_ACTION_5), down: held(InputAction.IA_BACKWARD, InputAction.IA_ACTION_6),
      left: held(InputAction.IA_LEFT, InputAction.IA_ACTION_3), right: held(InputAction.IA_RIGHT, InputAction.IA_ACTION_4),
      upPressed: pressed(InputAction.IA_FORWARD, InputAction.IA_ACTION_5), downPressed: pressed(InputAction.IA_BACKWARD, InputAction.IA_ACTION_6),
      leftPressed: pressed(InputAction.IA_LEFT, InputAction.IA_ACTION_3), rightPressed: pressed(InputAction.IA_RIGHT, InputAction.IA_ACTION_4),
      act: held(InputAction.IA_PRIMARY, InputAction.IA_JUMP), actPressed: pressed(InputAction.IA_PRIMARY, InputAction.IA_JUMP)
    }
    for (const clip of active.tick(keys, dt)) sound(clip)
    if (active.over()) offer(active)
    else submitted = false
  })
}
