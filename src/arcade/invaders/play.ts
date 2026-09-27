// PETAL INVADERS in the scene: stepping up to the cabinet, the controls, the sounds and the station's high score.
// The rules are game.ts; the screen is hud.tsx.
//
// Playing freezes the avatar (InputModifier), so the movement keys steer the ship instead of the player:
// A / D or the arrow keys (or 1 / 2) to move, E or Space to fire and start, F to walk away.
//
// The high score belongs to the station: synced between the players docked there, and only them, under a network
// id from the station's id (as the lifts do, lift/lifts.ts).
import { engine, Entity, Transform, InputModifier, inputSystem, InputAction, PointerEventType, AudioSource, Schemas } from '@dcl/sdk/ecs'
import { Vector3 } from '@dcl/sdk/math'
import { syncEntity } from '@dcl/sdk/network'
import { getPlayer } from '@dcl/sdk/players'
import { movePlayerTo } from '~system/RestrictedActions'
import { onGateChanged, getGateState, GateState } from '../../gate'
import { newGame, step, State, Sound } from './game'

const LEAVE_DISTANCE = 3 // metres from where the game put the player: past this (a teleport), the game stops
const SOUND_VOLUME = 0.55

const HiScore = engine.defineComponent('stellar::ArcadeHiScore', { score: Schemas.Int, name: Schemas.String })

let state: State = newGame()
let playing = false
let standAt: Vector3 | null = null
let hiEntity: Entity | null = null
let personalBest = 0
let submitted = false // this game's score has been offered to the high score table

export const invaders = () => state
export const isPlayingInvaders = () => playing
export const invadersBest = () => personalBest
/** The station's high score (0 and '' until someone sets one). */
export function invadersHiScore(): { score: number; name: string } {
  const h = hiEntity ? HiScore.getOrNull(hiEntity) : null
  return h ? { score: h.score, name: h.name } : { score: 0, name: '' }
}

/** Step up to the cabinet: stand `front` of it, looking at `screen`, with the avatar frozen. */
export function playInvaders(front: Vector3, screen: Vector3): void {
  if (playing) return
  movePlayerTo({ newRelativePosition: front, cameraTarget: screen })
  InputModifier.createOrReplace(engine.PlayerEntity, { mode: InputModifier.Mode.Standard({ disableAll: true }) })
  standAt = front
  state = newGame()
  playing = true
  submitted = false
}

export function quitInvaders(): void {
  if (!playing) return
  offerScore()
  playing = false
  standAt = null
  InputModifier.deleteFrom(engine.PlayerEntity)
}

/** Record this game's score, as a personal best and, if it beats it, the station's high score. */
function offerScore(): void {
  if (submitted || state.score <= 0) return
  submitted = true
  personalBest = Math.max(personalBest, state.score)
  if (hiEntity && state.score > invadersHiScore().score) {
    const name = (getPlayer()?.name || 'GARDENER').slice(0, 14).toUpperCase()
    HiScore.createOrReplace(hiEntity, { score: state.score, name })
  }
}

// ---- the station's high score entity ----------------------------------------------------------------------

function syncId(stationId: string): number {
  let h = 0x811c9dc5
  for (const ch of stationId) {
    h ^= ch.charCodeAt(0)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return 780000 + (h % 20000) // clear of the lifts' 720000..760000
}

function useStation(stationId: string | null): void {
  hiEntity = engine.addEntity()
  if (stationId) syncEntity(hiEntity, [HiScore.componentId], syncId(stationId))
}

// ---- sounds -------------------------------------------------------------------------------------------------

const CLIPS: Record<Exclude<Sound, 'step'>, string> = {
  shoot: 'assets/audio/arcade/shoot.wav',
  pop: 'assets/audio/arcade/pop.wav',
  hit: 'assets/audio/arcade/hit.wav',
  comet: 'assets/audio/arcade/comet.wav',
  bonus: 'assets/audio/arcade/bonus.wav',
  start: 'assets/audio/arcade/start.wav',
  over: 'assets/audio/arcade/over.wav',
  wave: 'assets/audio/arcade/wave.wav'
}
const speakers: Entity[] = []
let nextSpeaker = 0
let marchNote = 0

function play(sound: Sound): void {
  if (speakers.length === 0) for (let i = 0; i < 6; i++) speakers.push(engine.addEntity())
  const clip = sound === 'step' ? `assets/audio/arcade/step${marchNote++ % 4}.wav` : CLIPS[sound]
  // A few speakers in turn, so a shot doesn't cut off a pop; replacing the component restarts a clip.
  const speaker = speakers[nextSpeaker++ % speakers.length]
  AudioSource.createOrReplace(speaker, { audioClipUrl: clip, playing: true, loop: false, volume: SOUND_VOLUME, global: true })
}

// ---- running ------------------------------------------------------------------------------------------------

export function setupInvaders(): void {
  let station: string | null = null
  const onGate = (gate: GateState) => {
    const next = gate.kind === 'aboard' ? gate.stationId : null
    if (next !== station || !hiEntity) {
      station = next
      useStation(station)
    }
  }
  onGateChanged(onGate)
  onGate(getGateState())

  const held = (...keys: InputAction[]) => keys.some((k) => inputSystem.isPressed(k))
  const pressed = (...keys: InputAction[]) => keys.some((k) => inputSystem.isTriggered(k, PointerEventType.PET_DOWN))

  engine.addSystem((dt) => {
    if (!playing) return
    if (pressed(InputAction.IA_SECONDARY)) {
      quitInvaders()
      return
    }
    const me = Transform.getOrNull(engine.PlayerEntity)
    if (me && standAt && Vector3.distance(me.position, standAt) > LEAVE_DISTANCE) {
      quitInvaders()
      return
    }
    const sounds = step(state, {
      left: held(InputAction.IA_LEFT, InputAction.IA_ACTION_3),
      right: held(InputAction.IA_RIGHT, InputAction.IA_ACTION_4),
      fire: held(InputAction.IA_PRIMARY, InputAction.IA_JUMP),
      start: pressed(InputAction.IA_PRIMARY, InputAction.IA_JUMP)
    }, dt)
    for (const s of sounds) play(s)
    if (state.phase === 'over') offerScore()
    else if (state.phase === 'playing') submitted = false
  })
}
