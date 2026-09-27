// NEBULA BREAKER at its cabinet: the game (game.ts's rules) as cabinet.ts runs it. The screen is hud.tsx.
// Controls: left / right (A / D, the arrows, or 1 / 2) to move, E or Space to launch and start, F to walk away.
import { Vector3 } from '@dcl/sdk/math'
import { newGame, step, State } from './game'
import { CabinetGame, play, leave, playingGame, personalBest, stationHiScore } from '../cabinet'

let state: State = newGame()

const game: CabinetGame = {
  id: 'breaker',
  begin: () => { state = newGame() },
  tick: (keys, dt) => step(state, { left: keys.left, right: keys.right, launch: keys.actPressed }, dt),
  score: () => state.score,
  over: () => state.phase === 'over'
}

export const breaker = () => state
export const isPlayingBreaker = () => playingGame() === 'breaker'
export const breakerBest = () => personalBest('breaker')
export const breakerHiScore = () => stationHiScore('breaker')
export const playBreaker = (front: Vector3, screen: Vector3) => play(game, front, screen)
export const quitBreaker = leave
