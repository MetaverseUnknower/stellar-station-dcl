// ORBIT BLASTER at its cabinet: the game (game.ts's rules) as cabinet.ts runs it. The screen is hud.tsx.
// Controls: left / right (A / D, the arrows, or 1 / 2) round the orbit, E or Space to fire and start, F to walk away.
import { Vector3 } from '@dcl/sdk/math'
import { newGame, step, State } from './game'
import { CabinetGame, play, leave, playingGame, personalBest, stationHiScore } from '../cabinet'

let state: State = newGame()

const game: CabinetGame = {
  id: 'orbit',
  begin: () => { state = newGame() },
  tick: (keys, dt) => step(state, { left: keys.left, right: keys.right, fire: keys.act, start: keys.actPressed }, dt),
  score: () => state.score,
  over: () => state.phase === 'over'
}

export const orbit = () => state
export const isPlayingOrbit = () => playingGame() === 'orbit'
export const orbitBest = () => personalBest('orbit')
export const orbitHiScore = () => stationHiScore('orbit')
export const playOrbit = (front: Vector3, screen: Vector3) => play(game, front, screen)
export const quitOrbit = leave
