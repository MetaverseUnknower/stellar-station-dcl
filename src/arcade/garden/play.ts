// ASTRO GARDEN at its cabinet: the game (game.ts's rules) as cabinet.ts runs it. The screen is hud.tsx.
// Controls: the arrows / WASD (or 1-4: left, right, up, down) to steer, E or Space to start, F to walk away.
import { Vector3 } from '@dcl/sdk/math'
import { newGame, step, State, Dir } from './game'
import { CabinetGame, Keys, play, leave, playingGame, personalBest, stationHiScore } from '../cabinet'

let state: State = newGame()

/** The turn asked for this frame: the direction just pressed (a held key doesn't repeat). */
function turnFrom(k: Keys): Dir | null {
  if (k.upPressed) return 'up'
  if (k.downPressed) return 'down'
  if (k.leftPressed) return 'left'
  if (k.rightPressed) return 'right'
  return null
}

const game: CabinetGame = {
  id: 'garden',
  begin: () => { state = newGame() },
  tick: (keys, dt) => step(state, { turn: turnFrom(keys), start: keys.actPressed }, dt),
  score: () => state.score,
  over: () => state.phase === 'over'
}

export const garden = () => state
export const isPlayingGarden = () => playingGame() === 'garden'
export const gardenBest = () => personalBest('garden')
export const gardenHiScore = () => stationHiScore('garden')
export const playGarden = (front: Vector3, screen: Vector3) => play(game, front, screen)
export const quitGarden = leave
