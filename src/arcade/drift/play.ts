// STAR DRIFT at its cabinet: the game (game.ts's rules) as cabinet.ts runs it. The screen is hud.tsx.
// Controls: up (W / the arrow, or 3) or E / Space for the main engine; left / right (A / D, the arrows, or 1 / 2) for
// the side thrusters; E or Space to start; F to walk away.
import { Vector3 } from '@dcl/sdk/math'
import { newGame, step, State } from './game'
import { CabinetGame, play, leave, playingGame, personalBest, stationHiScore } from '../cabinet'

let state: State = newGame()

const game: CabinetGame = {
  id: 'drift',
  begin: () => { state = newGame() },
  tick: (keys, dt) => step(state, { up: keys.up || keys.act, left: keys.left, right: keys.right, start: keys.actPressed }, dt),
  score: () => state.score,
  over: () => state.phase === 'over'
}

export const drift = () => state
export const isPlayingDrift = () => playingGame() === 'drift'
export const driftBest = () => personalBest('drift')
export const driftHiScore = () => stationHiScore('drift')
export const playDrift = (front: Vector3, screen: Vector3) => play(game, front, screen)
export const quitDrift = leave
