// VOID RACER at its cabinet: the game (game.ts's rules) as cabinet.ts runs it. The screen is hud.tsx.
// Controls: left / right (A / D, the arrows, or 1 / 2) to steer, up (W, the arrow, or 3) or E / Space to accelerate,
// down (S, the arrow, or 4) to brake; E or Space to start; F to walk away.
import { Vector3 } from '@dcl/sdk/math'
import { newGame, step, State, Sound } from './game'
import { CabinetGame, play, leave, playingGame, personalBest, stationHiScore } from '../cabinet'

let state: State = newGame()
let throttling = false

// The game's sounds, as the arcade's clips.
const CLIPS: Record<Sound, string> = {
  engine: 'engine.ogg', crash: 'crash', orb: 'golden', pass: 'whoosh', checkpoint: 'checkpoint', start: 'start', over: 'over', tick: 'tick'
}

const game: CabinetGame = {
  id: 'racer',
  begin: () => { state = newGame() },
  tick: (keys, dt) => {
    throttling = keys.up || keys.act
    // The engine's a continuous hum (hum below), not the rules' per-stretch 'engine' ticks.
    return step(state, { left: keys.left, right: keys.right, throttle: throttling, brake: keys.down, start: keys.actPressed }, dt)
      .filter((s) => s !== 'engine')
      .map((s) => CLIPS[s])
  },
  score: () => state.score,
  over: () => state.phase === 'over',
  // The engine: a steady hum, pitched up with the speed (an octave and a bit from idle to flat out), louder on the
  // throttle; silent on the title and game-over screens.
  hum: () => {
    if (state.phase !== 'racing') return null
    const f = state.speed / 62
    return { clip: 'engine.ogg', pitch: 0.55 + f * 1.25, volume: throttling ? 0.5 : 0.32 }
  }
}

export const racer = () => state
export const isPlayingRacer = () => playingGame() === 'racer'
export const racerBest = () => personalBest('racer')
export const racerHiScore = () => stationHiScore('racer')
export const playRacer = (front: Vector3, screen: Vector3) => play(game, front, screen)
export const quitRacer = leave
