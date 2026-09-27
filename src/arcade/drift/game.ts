// STAR DRIFT: the rules, as plain data and functions (no SDK), so they can be tested on their own. The scene
// (play.ts) feeds step() the player's input each frame, draws the state (hud.tsx) and plays the sounds it reports.
//
// A lander: drift down onto a jagged moon with limited fuel and set down gently on a landing pad. Narrower pads pay
// more. The main engine pushes up; side thrusters push sideways. Land too fast, off a pad or on a slope and the ship
// is lost. Each landing brings new terrain, stronger gravity, and from level 3 a crosswind. Three ships.
//
// Units are field cells: the field is W x H, y downward from the top.

export const W = 20
export const H = 24
export const SHIP_W = 1.0
export const SHIP_H = 0.9
const MAIN_THRUST = 7.5
const SIDE_THRUST = 3.6
const MAIN_BURN = 16 // fuel per second
const SIDE_BURN = 7
const START_FUEL = 100
const REFUEL = 45 // added (to at most START_FUEL) after each landing
const SAFE_VY = 2.3 // landing speeds
const SAFE_VX = 1.3
const START_LIVES = 3
const COLUMNS = 41 // terrain points across the field (every 0.5)

export type Pad = { x0: number; x1: number; y: number; mult: number }
export type Phase = 'title' | 'flying' | 'landed' | 'crashed' | 'over'

export type State = {
  phase: Phase
  timer: number
  level: number
  lives: number
  score: number
  fuel: number
  x: number // the ship's centre
  y: number // its bottom (the landing legs)
  vx: number
  vy: number
  gravity: number
  wind: number // horizontal acceleration
  windTimer: number
  ground: number[] // terrain height (y) at x = i * (W / (COLUMNS - 1))
  pads: Pad[]
  thrusting: { main: boolean; left: boolean; right: boolean }
  lastLanding: { mult: number; points: number } | null
  rng: () => number
}

export type Input = { up: boolean; left: boolean; right: boolean; start: boolean }
export type Sound = 'thrust' | 'land' | 'crash' | 'lowfuel' | 'start' | 'over'

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

const STEP = W / (COLUMNS - 1)

/** The terrain's height at x (linear between its points). */
export function groundAt(s: State, x: number): number {
  const f = Math.max(0, Math.min(COLUMNS - 1, x / STEP))
  const i = Math.min(COLUMNS - 2, Math.floor(f))
  return s.ground[i] + (s.ground[i + 1] - s.ground[i]) * (f - i)
}

/** New terrain: jagged hills, with three flat pads cut in (widths 4, 2.5 and 1.5: x2, x3, x5). */
function makeTerrain(s: State): void {
  const g: number[] = []
  let y = 18 + s.rng() * 3
  for (let i = 0; i < COLUMNS; i++) {
    y += (s.rng() - 0.5) * 2.6
    y = Math.max(13.5, Math.min(23, y))
    g.push(y)
  }
  const pads: Pad[] = []
  const widths: [number, number][] = [[4, 2], [2.5, 3], [1.5, 5]]
  // Order them randomly across three thirds of the field, so they don't overlap.
  const thirds = [0, 1, 2].sort(() => s.rng() - 0.5)
  widths.forEach(([w, mult], k) => {
    const third = thirds[k]
    const x0 = third * (W / 3) + 0.5 + s.rng() * (W / 3 - w - 1)
    const x1 = x0 + w
    const i0 = Math.floor(x0 / STEP)
    const i1 = Math.ceil(x1 / STEP)
    const level = Math.min(...g.slice(i0, i1 + 1)) + 0.2
    for (let i = i0; i <= i1; i++) g[i] = level
    pads.push({ x0: i0 * STEP, x1: i1 * STEP, y: level, mult })
  })
  s.ground = g
  s.pads = pads
}

function spawn(s: State): void {
  s.x = 2 + s.rng() * (W - 4)
  s.y = 2.5
  s.vx = (s.rng() - 0.5) * 2
  s.vy = 0.5
}

export function newGame(rng: () => number = Math.random): State {
  const s: State = {
    phase: 'title', timer: 0, level: 1, lives: START_LIVES, score: 0, fuel: START_FUEL, x: W / 2, y: 2.5, vx: 0, vy: 0,
    gravity: 2.6, wind: 0, windTimer: 0, ground: [], pads: [], thrusting: { main: false, left: false, right: false },
    lastLanding: null, rng
  }
  makeTerrain(s)
  spawn(s)
  return s
}

function startLevel(s: State, level: number): void {
  s.level = level
  s.gravity = Math.min(4.6, 2.6 + (level - 1) * 0.35)
  s.wind = 0
  s.windTimer = 0
  makeTerrain(s)
  spawn(s)
}

/** Advance the game by dt seconds; returns the sounds to play. */
export function step(s: State, input: Input, dt: number): Sound[] {
  const sounds: Sound[] = []
  dt = Math.min(dt, 0.05)
  if (s.phase === 'title' || s.phase === 'over') {
    if (input.start) {
      Object.assign(s, newGame(s.rng), { phase: 'flying' as Phase })
      sounds.push('start')
    }
    return sounds
  }
  if (s.phase === 'landed' || s.phase === 'crashed') {
    s.timer -= dt
    if (s.timer > 0) return sounds
    if (s.phase === 'landed') {
      startLevel(s, s.level + 1)
      s.fuel = Math.min(START_FUEL, s.fuel + REFUEL)
    } else if (s.lives <= 0) {
      s.phase = 'over'
      sounds.push('over')
      return sounds
    } else {
      spawn(s)
      s.fuel = Math.max(s.fuel, START_FUEL * 0.6) // a fresh ship carries at least some fuel
    }
    s.phase = 'flying'
    return sounds
  }

  // Wind from level 3: a steady push that shifts every few seconds.
  if (s.level >= 3) {
    s.windTimer -= dt
    if (s.windTimer <= 0) {
      s.windTimer = 3 + s.rng() * 4
      const strength = Math.min(1.6, 0.4 + (s.level - 3) * 0.25)
      s.wind = (s.rng() - 0.5) * 2 * strength
    }
  }

  const had = s.fuel
  const main = input.up && s.fuel > 0
  const left = input.left && s.fuel > 0 // fires the right-hand thruster: pushes left
  const right = input.right && s.fuel > 0
  s.thrusting = { main, left, right }
  if (main || left || right) {
    s.fuel = Math.max(0, s.fuel - ((main ? MAIN_BURN : 0) + (left || right ? SIDE_BURN : 0)) * dt)
    if (Math.floor(s.fuel / 4) !== Math.floor(had / 4)) sounds.push('thrust') // a puff every few units burnt
  }
  if (had > 20 && s.fuel <= 20) sounds.push('lowfuel')

  s.vy += (s.gravity - (main ? MAIN_THRUST : 0)) * dt
  s.vx += ((right ? SIDE_THRUST : 0) - (left ? SIDE_THRUST : 0) + s.wind) * dt
  s.x += s.vx * dt
  s.y += s.vy * dt
  if (s.x < SHIP_W / 2) { s.x = SHIP_W / 2; s.vx = 0 }
  if (s.x > W - SHIP_W / 2) { s.x = W - SHIP_W / 2; s.vx = 0 }
  if (s.y < SHIP_H + 0.2) { s.y = SHIP_H + 0.2; s.vy = Math.max(0, s.vy) }

  // Touchdown: either leg on the ground.
  const lx = s.x - SHIP_W / 2
  const rx = s.x + SHIP_W / 2
  const touch = Math.min(groundAt(s, lx), groundAt(s, rx), groundAt(s, s.x))
  if (s.y >= touch) {
    const pad = s.pads.find((p) => lx >= p.x0 - 0.05 && rx <= p.x1 + 0.05)
    const gentle = s.vy <= SAFE_VY && Math.abs(s.vx) <= SAFE_VX
    if (pad && gentle) {
      s.y = pad.y
      const softness = Math.round((1 - s.vy / SAFE_VY) * 50)
      const points = (50 + softness) * pad.mult * s.level + Math.round(s.fuel)
      s.score += points
      s.lastLanding = { mult: pad.mult, points }
      s.phase = 'landed'
      s.timer = 2.4
      sounds.push('land')
    } else {
      s.y = touch
      s.lives -= 1
      s.phase = 'crashed'
      s.timer = 1.8
      sounds.push('crash')
    }
    s.vx = 0
    s.vy = 0
    s.thrusting = { main: false, left: false, right: false }
  }
  return sounds
}
