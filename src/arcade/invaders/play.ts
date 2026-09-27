// PETAL INVADERS at its cabinet: the game (game.ts's rules) as cabinet.ts runs it. The screen is hud.tsx.
// Controls: left / right (A / D, the arrows, or 1 / 2) to move, E or Space to fire and start, F to walk away.
import { Vector3 } from '@dcl/sdk/math'
import { newGame, step, State } from './game'
import { CabinetGame, play, leave, playingGame, personalBest, stationHiScore } from '../cabinet'

let state: State = newGame()
let march = 0 // the formation's four-note march, one note per step

const game: CabinetGame = {
  id: 'invaders',
  begin: () => { state = newGame() },
  tick: (keys, dt) => {
    const sounds = step(state, { left: keys.left, right: keys.right, fire: keys.act, start: keys.actPressed }, dt)
    return sounds.map((s) => (s === 'step' ? `step${march++ % 4}` : s))
  },
  score: () => state.score,
  over: () => state.phase === 'over'
}

export const invaders = () => state
export const isPlayingInvaders = () => playingGame() === 'invaders'
export const invadersBest = () => personalBest('invaders')
export const invadersHiScore = () => stationHiScore('invaders')
export const playInvaders = (front: Vector3, screen: Vector3) => play(game, front, screen)
export const quitInvaders = leave
