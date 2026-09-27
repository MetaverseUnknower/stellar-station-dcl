// COMET RUN at its cabinet: the game (game.ts's rules) as cabinet.ts runs it. The screen is hud.tsx.
// Controls: the arrows / WASD (or 1-4) to steer, hold E or Space to boost (press to start), F to walk away.
import { Vector3 } from '@dcl/sdk/math'
import { newGame, step, State } from './game'
import { CabinetGame, play, leave, playingGame, personalBest, stationHiScore } from '../cabinet'

let state: State = newGame()

const game: CabinetGame = {
  id: 'comet',
  begin: () => { state = newGame() },
  tick: (keys, dt) =>
    step(state, { up: keys.up, down: keys.down, left: keys.left, right: keys.right, boost: keys.act, start: keys.actPressed }, dt),
  score: () => Math.floor(state.score),
  over: () => state.phase === 'over'
}

export const comet = () => state
export const isPlayingComet = () => playingGame() === 'comet'
export const cometBest = () => personalBest('comet')
export const cometHiScore = () => stationHiScore('comet')
export const playComet = (front: Vector3, screen: Vector3) => play(game, front, screen)
export const quitComet = leave
