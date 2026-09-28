// What every playable arcade cabinet shares: stepping up to it, the controls, the sounds, and the station's high
// score table for each game.
//
// Playing freezes the avatar (InputModifier), so the movement keys steer the game instead of the player. The keys a
// game can read: the arrows / WASD (the explorer's movement actions), 1-4 as a fallback (in case the explorer keeps
// movement to itself while frozen), E or Space to act and start, F to walk away. Walking away (or being moved off,
// e.g. teleported) ends the session.
//
// High scores belong to the station, kept by the game server (routes/arcade.ts): every player's best at each game,
// per station. Loaded on arriving, posted at each game over.
import { engine, Entity, Transform, InputModifier, inputSystem, InputAction, PointerEventType, AudioSource } from '@dcl/sdk/ecs'
import { Vector3 } from '@dcl/sdk/math'
import { getPlayer } from '@dcl/sdk/players'
import { movePlayerTo } from '~system/RestrictedActions'
import { onGateChanged, getGateState, GateState } from '../gate'
import { getArcadeScores, postArcadeScore, ArcadeTables, ArcadeEntry } from '../stationApi'

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
  /** Advance; returns the sound clips (file names under assets/audio/arcade, without .mp3) to play. */
  tick(keys: Keys, dt: number): string[]
  /** The score of the game in progress or just ended; and whether it has ended (then it's offered as a record). */
  score(): number
  over(): boolean
  /** A continuous sound, if the game has one (an engine): a looping clip, and its pitch and volume now; null for
   *  silence. Read every frame. */
  hum?(): { clip: string; pitch: number; volume: number } | null
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
  setHum(null)
  offer(active)
  active = null
  standAt = null
  InputModifier.deleteFrom(engine.PlayerEntity)
}

// ---- high scores ---------------------------------------------------------------------------------------------------

// Kept by the game server (routes/arcade.ts): each station's table per game, every player's best. Loaded on arriving
// at a station (and again after each game over); a game over posts its score. Until the server answers, a game's
// high score is 0 and '' (and the station's cabinets show none).

let station: string | null = null
let tables: ArcadeTables['games'] = {}
let loading = false

async function loadTables(): Promise<void> {
  if (!station || loading) return
  loading = true
  try {
    tables = (await getArcadeScores(station)).games ?? {}
    for (const [game, t] of Object.entries(tables)) bests.set(game, Math.max(personalBest(game), t.mine ?? 0))
  } catch (e) {
    console.log('[arcade] high scores unavailable', e)
  } finally {
    loading = false
  }
}

/** A game's high score at this station (0 and '' until someone sets one, or until the server answers). */
export function stationHiScore(game: string): { score: number; name: string } {
  const top = tables[game]?.top?.[0]
  return top ? { score: top.score, name: top.name.slice(0, 14).toUpperCase() } : { score: 0, name: '' }
}

/** A game's top five at this station, best first. */
export const stationTop = (game: string): ArcadeEntry[] => tables[game]?.top ?? []

/** Record a finished game's score: a personal best, and on the server, which keeps the station's table. */
function offer(game: CabinetGame): void {
  const score = Math.floor(game.score())
  if (submitted || score <= 0) return
  submitted = true
  bests.set(game.id, Math.max(personalBest(game.id), score))
  // Shown straight away if it tops the table; the server's answer (and the reloaded table) follows.
  if (score > stationHiScore(game.id).score) {
    const name = getPlayer()?.name || 'Gardener'
    const t = (tables[game.id] ??= { top: [], mine: 0 })
    t.top = [{ name, score }, ...t.top].slice(0, 5)
  }
  if (!station) return
  postArcadeScore(station, game.id, score)
    .then(() => loadTables())
    .catch((e) => console.log('[arcade] score not recorded', e))
}

// ---- sounds --------------------------------------------------------------------------------------------------------

const speakers: Entity[] = []
let nextSpeaker = 0

function sound(clip: string): void {
  if (speakers.length === 0) {
    for (let i = 0; i < 6; i++) {
      const e = engine.addEntity()
      Transform.create(e, { parent: engine.PlayerEntity }) // with the player (they're global, but give them a place)
      speakers.push(e)
    }
  }
  // A few speakers in turn, so one sound doesn't cut off another; replacing the component restarts a clip.
  const speaker = speakers[nextSpeaker++ % speakers.length]
  AudioSource.createOrReplace(speaker, { audioClipUrl: `assets/audio/arcade/${clip}.mp3`, playing: true, loop: false, volume: SOUND_VOLUME, global: true })
}

let humSpeaker: Entity | null = null
let humClip: string | null = null

/** Keep the game's continuous sound playing, at its pitch and volume (null: silent). */
function setHum(h: { clip: string; pitch: number; volume: number } | null): void {
  if (!h) {
    if (humSpeaker && AudioSource.has(humSpeaker)) AudioSource.getMutable(humSpeaker).playing = false
    humClip = null
    return
  }
  if (!humSpeaker) {
    humSpeaker = engine.addEntity()
    Transform.create(humSpeaker, { parent: engine.PlayerEntity })
  }
  if (humClip !== h.clip) {
    humClip = h.clip
    // A clip named with its extension is taken as it is (the engine's loop is an OGG, which loops without a gap).
    const file = h.clip.includes('.') ? h.clip : `${h.clip}.mp3`
    AudioSource.createOrReplace(humSpeaker, { audioClipUrl: `assets/audio/arcade/${file}`, playing: true, loop: true, volume: h.volume, pitch: h.pitch, global: true })
    return
  }
  const a = AudioSource.getMutable(humSpeaker)
  if (!a.playing) a.playing = true
  if (Math.abs((a.pitch ?? 1) - h.pitch) > 0.01) a.pitch = h.pitch
  if (Math.abs((a.volume ?? 1) - h.volume) > 0.01) a.volume = h.volume
}

// ---- running -------------------------------------------------------------------------------------------------------

export function setupCabinets(): void {
  const onGate = (gate: GateState) => {
    const next = gate.kind === 'aboard' ? gate.stationId : null
    if (next !== station) {
      station = next
      tables = {}
      void loadTables()
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
    setHum(active.hum ? active.hum() : null)
    if (active.over()) offer(active)
    else submitted = false
  })
}
