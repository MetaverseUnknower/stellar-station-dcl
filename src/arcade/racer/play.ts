// VOID RACER at its cabinet: the game (game.ts's rules) as cabinet.ts runs it. The screen is hud.tsx.
// Controls: left / right (A / D, the arrows, or 1 / 2) to steer, up (W, the arrow, or 3) or E / Space to accelerate,
// down (S, the arrow, or 4) to brake; E or Space to start; F to walk away.
import { Vector3 } from '@dcl/sdk/math'
import { newGame, step, State, Sound } from './game'
import { CabinetGame, play, leave, playingGame, personalBest, stationHiScore } from '../cabinet'

let state: State = newGame()

// The game's sounds, as the arcade's clips.
const CLIPS: Record<Sound, string> = {
  engine: 'engine', crash: 'crash', orb: 'golden', pass: 'whoosh', checkpoint: 'checkpoint', start: 'start', over: 'over', tick: 'tick'
}

const game: CabinetGame = {
  id: 'racer',
  begin: () => { state = newGame() },
  tick: (keys, dt) =>
    step(state, { left: keys.left, right: keys.right, throttle: keys.up || keys.act, brake: keys.down, start: keys.actPressed }, dt).map(
      (s) => CLIPS[s]
    ),
  score: () => state.score,
  over: () => state.phase === 'over'
}

export const racer = () => state
export const isPlayingRacer = () => playingGame() === 'racer'
export const racerBest = () => personalBest('racer')
export const racerHiScore = () => stationHiScore('racer')
export const playRacer = (front: Vector3, screen: Vector3) => play(game, front, screen)
export const quitRacer = leave
