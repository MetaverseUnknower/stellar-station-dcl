// PETAL INVADERS: the rules, as plain data and functions (no SDK), so they can be tested on their own. The scene
// (play.ts) feeds step() the player's input each frame, draws the state (hud.tsx) and plays the sounds it reports.
//
// A space-garden Space Invaders: a petal ship along the bottom defends the station's garden from ranks of aphids
// marching back and forth and down, faster as they thin out. Bunkers of soil soak up shots; a comet sometimes
// streaks across the top for a bonus.
//
// Units are field cells: the field is W x H, y downward from the top.

export const W = 20
export const H = 24
export const COLS = 9
export const ROWS = 5
const CELL_X = 1.8
const CELL_Y = 1.5
export const ALIEN_W = 1.3
export const ALIEN_H = 0.9
export const SHIP_Y = 22.2
export const SHIP_W = 1.6
export const SHIP_H = 0.9
const SHIP_SPEED = 13
const SHOT_SPEED = 30
export const SHOT_W = 0.18
export const SHOT_H = 0.7
const SHOT_COOLDOWN = 0.22
const BOMB_SPEED = 10
export const BOMB_W = 0.22
export const BOMB_H = 0.6
const MAX_BOMBS = 3
export const BUNKER_Y = 19.2
export const BUNKER_CELL = 0.55
const BUNKER_COLS = 6
const BUNKER_ROWS = 3
const BUNKER_XS = [2.6, 7.4, 12.2, 17.0] // bunker centres
const START_LIVES = 3
const STEP_X = 0.45
const DROP_Y = 0.6
export const COMET_Y = 1.1
export const COMET_W = 1.8
export const COMET_H = 0.8
const COMET_SPEED = 6
const HIT_PAUSE = 1.6 // seconds the field freezes after the ship is hit
export const ROW_POINTS = [30, 20, 20, 10, 10] // top row first
export const COMET_POINTS = [100, 150, 200, 300]

export type Alien = { x: number; y: number; row: number; alive: boolean }
export type Rect = { x: number; y: number }
export type Cell = Rect & { hp: number }
export type Comet = Rect & { dir: 1 | -1; points: number }
export type Phase = 'title' | 'playing' | 'hit' | 'cleared' | 'over'

export type State = {
  phase: Phase
  timer: number // seconds left in 'hit' / 'cleared'
  score: number
  lives: number
  wave: number
  shipX: number // the ship's centre
  shipFlash: number // seconds of the hit flash left
  aliens: Alien[]
  dir: 1 | -1
  stepTimer: number
  stepFrame: number // which of the two animation frames (flips on each step)
  shots: Rect[] // the ship's
  shotCooldown: number
  bombs: Rect[] // the aliens'
  bombTimer: number
  bunkers: Cell[]
  comet: Comet | null
  cometTimer: number
  popped: { x: number; y: number; t: number; text?: string }[] // explosions and bonus labels
  rng: () => number
}

export type Input = { left: boolean; right: boolean; fire: boolean; start: boolean }
export type Sound = 'shoot' | 'pop' | 'hit' | 'step' | 'comet' | 'bonus' | 'start' | 'over' | 'wave'

/** A small seeded random source (mulberry32), so a test can replay a game exactly. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function makeAliens(wave: number): Alien[] {
  const top = 3 + Math.min(wave - 1, 5) * 0.6 // later waves start lower
  const left = (W - ((COLS - 1) * CELL_X + ALIEN_W)) / 2
  const out: Alien[] = []
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) out.push({ x: left + col * CELL_X, y: top + row * CELL_Y, row, alive: true })
  }
  return out
}

function makeBunkers(): Cell[] {
  const out: Cell[] = []
  for (const cx of BUNKER_XS) {
    const left = cx - (BUNKER_COLS * BUNKER_CELL) / 2
    for (let r = 0; r < BUNKER_ROWS; r++) {
      for (let c = 0; c < BUNKER_COLS; c++) {
        if (r === BUNKER_ROWS - 1 && (c === 2 || c === 3)) continue // the arch underneath
        out.push({ x: left + c * BUNKER_CELL, y: BUNKER_Y + r * BUNKER_CELL, hp: 2 })
      }
    }
  }
  return out
}

export function newGame(rng: () => number = Math.random): State {
  return {
    phase: 'title', timer: 0, score: 0, lives: START_LIVES, wave: 1, shipX: W / 2, shipFlash: 0,
    aliens: makeAliens(1), dir: 1, stepTimer: 0, stepFrame: 0, shots: [], shotCooldown: 0, bombs: [], bombTimer: 1.5,
    bunkers: makeBunkers(), comet: null, cometTimer: 12, popped: [], rng
  }
}

function startWave(s: State, wave: number): void {
  s.wave = wave
  s.aliens = makeAliens(wave)
  s.dir = 1
  s.stepTimer = 0
  s.shots = []
  s.bombs = []
  s.bombTimer = 1.5
  s.comet = null
  s.cometTimer = 10 + s.rng() * 10
}

const overlaps = (ax: number, ay: number, aw: number, ah: number, bx: number, by: number, bw: number, bh: number) =>
  ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by

/** Seconds between the formation's steps: slow when full, quick when nearly empty, quicker each wave. */
export function stepInterval(alive: number, wave: number): number {
  return Math.max(0.04, (0.05 + 0.55 * (alive / (ROWS * COLS))) * Math.pow(0.9, wave - 1))
}

/** Advance the game by dt seconds; returns the sounds to play. */
export function step(s: State, input: Input, dt: number): Sound[] {
  const sounds: Sound[] = []
  dt = Math.min(dt, 0.05)
  s.popped = s.popped.filter((p) => (p.t -= dt) > 0)
  s.shipFlash = Math.max(0, s.shipFlash - dt)

  if (s.phase === 'title' || s.phase === 'over') {
    if (input.start) {
      const rng = s.rng
      Object.assign(s, newGame(rng), { phase: 'playing' as Phase })
      sounds.push('start')
    }
    return sounds
  }
  if (s.phase === 'hit' || s.phase === 'cleared') {
    s.timer -= dt
    if (s.timer > 0) return sounds
    if (s.phase === 'cleared') {
      startWave(s, s.wave + 1)
      sounds.push('wave')
    } else if (s.lives <= 0) {
      s.phase = 'over'
      sounds.push('over')
      return sounds
    }
    s.phase = 'playing'
    s.bombs = []
    return sounds
  }

  // The ship.
  const move = (input.right ? 1 : 0) - (input.left ? 1 : 0)
  s.shipX = Math.max(SHIP_W / 2, Math.min(W - SHIP_W / 2, s.shipX + move * SHIP_SPEED * dt))
  s.shotCooldown -= dt
  if (input.fire && s.shotCooldown <= 0 && s.shots.length < 2) {
    s.shots.push({ x: s.shipX - SHOT_W / 2, y: SHIP_Y - SHOT_H })
    s.shotCooldown = SHOT_COOLDOWN
    sounds.push('shoot')
  }

  // The formation: steps sideways, and down and back at the edges.
  const alive = s.aliens.filter((a) => a.alive)
  s.stepTimer -= dt
  if (s.stepTimer <= 0) {
    s.stepTimer = stepInterval(alive.length, s.wave)
    s.stepFrame ^= 1
    const minX = Math.min(...alive.map((a) => a.x))
    const maxX = Math.max(...alive.map((a) => a.x + ALIEN_W))
    const edge = (s.dir === 1 && maxX + STEP_X > W - 0.2) || (s.dir === -1 && minX - STEP_X < 0.2)
    for (const a of alive) {
      if (edge) a.y += DROP_Y
      else a.x += s.dir * STEP_X
    }
    if (edge) s.dir = s.dir === 1 ? -1 : 1
    sounds.push('step')
  }

  // Bombs from the lowest alien in a random column, now and then.
  s.bombTimer -= dt
  if (s.bombTimer <= 0 && s.bombs.length < MAX_BOMBS && alive.length > 0) {
    s.bombTimer = Math.max(0.35, 1.2 - 0.1 * s.wave) * (0.6 + s.rng() * 0.8)
    const shooter = alive[Math.floor(s.rng() * alive.length)]
    const lowest = alive.filter((a) => Math.abs(a.x - shooter.x) < 0.01).reduce((m, a) => (a.y > m.y ? a : m), shooter)
    s.bombs.push({ x: lowest.x + ALIEN_W / 2 - BOMB_W / 2, y: lowest.y + ALIEN_H })
  }

  // The comet: across the top every so often.
  if (s.comet) {
    s.comet.x += s.comet.dir * COMET_SPEED * dt
    if (s.comet.x < -COMET_W - 1 || s.comet.x > W + 1) s.comet = null
  } else {
    s.cometTimer -= dt
    if (s.cometTimer <= 0) {
      const dir = s.rng() < 0.5 ? 1 : -1
      s.comet = { x: dir === 1 ? -COMET_W : W, y: COMET_Y, dir, points: COMET_POINTS[Math.floor(s.rng() * COMET_POINTS.length)] }
      s.cometTimer = 15 + s.rng() * 12
      sounds.push('comet')
    }
  }

  // Shots up: aliens, the comet, bunkers, or off the top.
  s.shots = s.shots.filter((shot) => {
    shot.y -= SHOT_SPEED * dt
    if (shot.y + SHOT_H < 0) return false
    for (const a of alive) {
      if (a.alive && overlaps(shot.x, shot.y, SHOT_W, SHOT_H, a.x, a.y, ALIEN_W, ALIEN_H)) {
        a.alive = false
        s.score += ROW_POINTS[a.row]
        s.popped.push({ x: a.x + ALIEN_W / 2, y: a.y + ALIEN_H / 2, t: 0.25 })
        sounds.push('pop')
        return false
      }
    }
    if (s.comet && overlaps(shot.x, shot.y, SHOT_W, SHOT_H, s.comet.x, s.comet.y, COMET_W, COMET_H)) {
      s.score += s.comet.points
      s.popped.push({ x: s.comet.x + COMET_W / 2, y: s.comet.y + COMET_H / 2, t: 1.2, text: `${s.comet.points}` })
      s.comet = null
      sounds.push('bonus')
      return false
    }
    return !hitBunker(s, shot.x, shot.y, SHOT_W, SHOT_H)
  })

  // Bombs down: bunkers, the ship, or off the bottom.
  let shipHit = false
  s.bombs = s.bombs.filter((b) => {
    b.y += BOMB_SPEED * dt
    if (b.y > H) return false
    if (hitBunker(s, b.x, b.y, BOMB_W, BOMB_H)) return false
    if (overlaps(b.x, b.y, BOMB_W, BOMB_H, s.shipX - SHIP_W / 2, SHIP_Y, SHIP_W, SHIP_H)) {
      shipHit = true
      return false
    }
    return true
  })

  // Aliens chew through bunkers they reach, and end the game if they reach the ship's row.
  const living = s.aliens.filter((a) => a.alive)
  for (const a of living) {
    s.bunkers = s.bunkers.filter((c) => !overlaps(a.x, a.y, ALIEN_W, ALIEN_H, c.x, c.y, BUNKER_CELL, BUNKER_CELL))
  }
  const landed = living.some((a) => a.y + ALIEN_H >= SHIP_Y)

  if (landed) {
    s.lives = 0
    s.phase = 'over'
    sounds.push('over')
  } else if (shipHit) {
    s.lives -= 1
    s.phase = 'hit'
    s.timer = HIT_PAUSE
    s.shipFlash = HIT_PAUSE
    s.shots = []
    sounds.push('hit')
  } else if (living.length === 0) {
    s.phase = 'cleared'
    s.timer = 2
    s.shots = []
    s.bombs = []
  }
  return sounds
}

function hitBunker(s: State, x: number, y: number, w: number, h: number): boolean {
  const i = s.bunkers.findIndex((c) => overlaps(x, y, w, h, c.x, c.y, BUNKER_CELL, BUNKER_CELL))
  if (i < 0) return false
  s.bunkers[i].hp -= 1
  if (s.bunkers[i].hp <= 0) s.bunkers.splice(i, 1)
  return true
}
