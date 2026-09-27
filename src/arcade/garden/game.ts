// ASTRO GARDEN: the rules, as plain data and functions (no SDK), so they can be tested on their own. The scene
// (play.ts) feeds step() the player's turns each frame, draws the state (hud.tsx) and plays the sounds it reports.
//
// A space vine grows across a garden bed collecting star seeds. Every seed makes it longer and blooms a flower on
// it, where it was eaten, that the vine carries along; now and then a golden seed appears for big points and wilts if
// you're slow. Asteroid rocks land in the bed as you level up. Hitting the edge, a rock or yourself ends it. The
// vine speeds up as it grows.
//
// Grid cells: the bed is W x H, x right, y down.

export const W = 24
export const H = 18
const START_LENGTH = 4
const START_INTERVAL = 0.17 // seconds per step at the start
const MIN_INTERVAL = 0.07
const SPEEDUP = 0.008 // seconds off the interval per level
const SEEDS_PER_LEVEL = 5
const ROCKS_PER_LEVEL = 2
const GOLDEN_CHANCE = 0.18 // after each seed, the chance a golden seed appears (if none is out)
const GOLDEN_SECONDS = 7
const GOLDEN_GROWTH = 3
export const SEED_POINTS = 10
export const GOLDEN_POINTS = 50

export type Cell = { x: number; y: number }
export type Segment = Cell & { bloom: number } // bloom: 0 none, else a flower colour (1..4)
export type Dir = 'up' | 'down' | 'left' | 'right'
export type Phase = 'title' | 'playing' | 'over'

export type State = {
  phase: Phase
  vine: Segment[] // head first
  dir: Dir
  turns: Dir[] // queued turns (up to two, so quick taps both count)
  grow: number // segments still to add
  seed: Cell
  golden: (Cell & { left: number }) | null
  rocks: Cell[]
  score: number
  seeds: number
  level: number
  timer: number // until the next step
  crashed: Cell | null // where it ended, for the screen
  rng: () => number
}

export type Input = { turn: Dir | null; start: boolean }
export type Sound = 'munch' | 'golden' | 'crash' | 'start' | 'level' | 'wilt'

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

const DELTA: Record<Dir, Cell> = { up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } }
const OPPOSITE: Record<Dir, Dir> = { up: 'down', down: 'up', left: 'right', right: 'left' }
const same = (a: Cell, b: Cell) => a.x === b.x && a.y === b.y

export function interval(level: number): number {
  return Math.max(MIN_INTERVAL, START_INTERVAL - SPEEDUP * (level - 1))
}

function occupied(s: State, c: Cell): boolean {
  return s.vine.some((v) => same(v, c)) || s.rocks.some((r) => same(r, c)) || same(s.seed, c) || (s.golden !== null && same(s.golden, c))
}

/** A free cell, keeping clear of the few cells right ahead of the head (nothing lands in its face). */
function freeCell(s: State): Cell {
  const head = s.vine[0]
  const d = DELTA[s.dir]
  for (let tries = 0; tries < 500; tries++) {
    const c = { x: Math.floor(s.rng() * W), y: Math.floor(s.rng() * H) }
    if (occupied(s, c)) continue
    let ahead = false
    for (let k = 1; k <= 3; k++) if (same(c, { x: head.x + d.x * k, y: head.y + d.y * k })) ahead = true
    if (ahead) continue
    return c
  }
  return { x: 0, y: 0 }
}

export function newGame(rng: () => number = Math.random): State {
  const y = Math.floor(H / 2)
  const vine: Segment[] = []
  for (let i = 0; i < START_LENGTH; i++) vine.push({ x: 6 - i, y, bloom: 0 })
  const s: State = {
    phase: 'title', vine, dir: 'right', turns: [], grow: 0, seed: { x: 0, y: 0 }, golden: null, rocks: [],
    score: 0, seeds: 0, level: 1, timer: START_INTERVAL, crashed: null, rng
  }
  s.seed = freeCell(s)
  return s
}

/** Advance the game by dt seconds; returns the sounds to play. */
export function step(s: State, input: Input, dt: number): Sound[] {
  const sounds: Sound[] = []
  if (s.phase !== 'playing') {
    if (input.start) {
      Object.assign(s, newGame(s.rng), { phase: 'playing' as Phase })
      sounds.push('start')
    }
    return sounds
  }
  // Queue a turn: not straight back on itself, and not the same way twice.
  if (input.turn) {
    const last = s.turns.length ? s.turns[s.turns.length - 1] : s.dir
    if (input.turn !== last && input.turn !== OPPOSITE[last] && s.turns.length < 2) s.turns.push(input.turn)
  }
  if (s.golden) {
    s.golden.left -= dt
    if (s.golden.left <= 0) {
      s.golden = null
      sounds.push('wilt')
    }
  }
  s.timer -= Math.min(dt, 0.1)
  while (s.timer <= 0 && s.phase === 'playing') {
    s.timer += interval(s.level)
    if (s.turns.length) s.dir = s.turns.shift() as Dir
    const d = DELTA[s.dir]
    const head = { x: s.vine[0].x + d.x, y: s.vine[0].y + d.y }
    // The tail moves out of the way this step unless the vine is growing.
    const body = s.grow > 0 ? s.vine : s.vine.slice(0, -1)
    if (head.x < 0 || head.y < 0 || head.x >= W || head.y >= H || s.rocks.some((r) => same(r, head)) || body.some((v) => same(v, head))) {
      s.phase = 'over'
      s.crashed = head
      sounds.push('crash')
      break
    }
    s.vine.unshift({ ...head, bloom: 0 })
    if (s.grow > 0) s.grow--
    else s.vine.pop()

    if (same(head, s.seed)) {
      s.seeds++
      s.score += SEED_POINTS * s.level
      s.grow += 1
      s.vine[0].bloom = 1 + Math.floor(s.rng() * 4)
      sounds.push('munch')
      if (s.seeds % SEEDS_PER_LEVEL === 0) {
        s.level++
        for (let k = 0; k < ROCKS_PER_LEVEL; k++) s.rocks.push(freeCell(s))
        sounds.push('level')
      }
      s.seed = freeCell(s)
      if (!s.golden && s.rng() < GOLDEN_CHANCE) s.golden = { ...freeCell(s), left: GOLDEN_SECONDS }
    } else if (s.golden && same(head, s.golden)) {
      s.score += GOLDEN_POINTS * s.level
      s.grow += GOLDEN_GROWTH
      s.vine[0].bloom = 5 // gold
      s.golden = null
      sounds.push('golden')
    }
  }
  return sounds
}
