// COMET RUN: the rules, as plain data and functions (no SDK), so they can be tested on their own. The scene (play.ts)
// feeds step() the player's input each frame, draws the state (hud.tsx) and plays the sounds it reports.
//
// You're a comet streaking up through an asteroid field that pours down ever faster. Steer anywhere in the lower half.
// Score comes from distance, stardust, and near misses (skimming past an asteroid without touching it). Hold boost to
// go faster for double points while its meter lasts. A rare shield soaks up one hit. Three lives.
//
// Units are field cells: the field is W x H, y downward from the top.

export const W = 20
export const H = 24
export const COMET_R = 0.42
const MOVE_SPEED = 13
const TOP_LIMIT = 11 // the comet stays in the lower half
const BOTTOM_LIMIT = 22.6
const START_SCROLL = 7
const MAX_SCROLL = 21
const SCROLL_GAIN = 0.22 // per second
const BOOST_FACTOR = 1.6
const BOOST_DRAIN = 1 / 3 // meter per second of boosting (full lasts 3 s)
const BOOST_REFILL = 1 / 9 // meter per second off it
const NEAR_MISS = 1.0 // metres of clearance that count as a near miss
const SHIELD_CHANCE = 0.04 // per second
const HIT_INVULNERABLE = 1.6
const START_LIVES = 3
export const DUST_R = 0.18

export type Rock = { x: number; y: number; r: number; vx: number; speed: number; spin: number; grazed: boolean; closest?: number }
export type Dust = { x: number; y: number }
export type Phase = 'title' | 'playing' | 'over'

export type State = {
  phase: Phase
  x: number
  y: number
  score: number
  lives: number
  distance: number
  scroll: number // metres per second the field moves at
  boost: number // meter, 0..1
  boosting: boolean
  shield: boolean
  invulnerable: number
  rocks: Rock[]
  dust: Dust[]
  shieldPickup: Dust | null
  spawnTimer: number
  dustTimer: number
  time: number
  popups: { x: number; y: number; t: number; text: string }[]
  rng: () => number
}

export type Input = { up: boolean; down: boolean; left: boolean; right: boolean; boost: boolean; start: boolean }
export type Sound = 'dust' | 'whoosh' | 'shield' | 'hit' | 'start' | 'over' | 'boost' | 'block'

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

export function newGame(rng: () => number = Math.random): State {
  return {
    phase: 'title', x: W / 2, y: 19, score: 0, lives: START_LIVES, distance: 0, scroll: START_SCROLL, boost: 1,
    boosting: false, shield: false, invulnerable: 0, rocks: [], dust: [], shieldPickup: null, spawnTimer: 0.8,
    dustTimer: 2, time: 0, popups: [], rng
  }
}

/** Seconds between asteroids at a given scroll speed: more of them as it speeds up. */
export function spawnInterval(scroll: number): number {
  return Math.max(0.18, 0.9 - (scroll - START_SCROLL) * 0.05)
}

/** Advance the game by dt seconds; returns the sounds to play. */
export function step(s: State, input: Input, dt: number): Sound[] {
  const sounds: Sound[] = []
  dt = Math.min(dt, 0.05)
  s.popups = s.popups.filter((p) => (p.t -= dt) > 0)
  if (s.phase !== 'playing') {
    if (input.start) {
      Object.assign(s, newGame(s.rng), { phase: 'playing' as Phase })
      sounds.push('start')
    }
    return sounds
  }
  s.time += dt
  s.invulnerable = Math.max(0, s.invulnerable - dt)

  // Boost: faster and double points, while the meter lasts.
  const wasBoosting = s.boosting
  s.boosting = input.boost && s.boost > 0.02
  if (s.boosting && !wasBoosting) sounds.push('boost')
  s.boost = Math.max(0, Math.min(1, s.boost + (s.boosting ? -BOOST_DRAIN : BOOST_REFILL) * dt))
  s.scroll = Math.min(MAX_SCROLL, s.scroll + SCROLL_GAIN * dt)
  const speed = s.scroll * (s.boosting ? BOOST_FACTOR : 1)
  const mult = s.boosting ? 2 : 1

  // The comet.
  const dx = (input.right ? 1 : 0) - (input.left ? 1 : 0)
  const dy = (input.down ? 1 : 0) - (input.up ? 1 : 0)
  const n = Math.hypot(dx, dy) || 1
  s.x = Math.max(COMET_R, Math.min(W - COMET_R, s.x + (dx / n) * MOVE_SPEED * dt))
  s.y = Math.max(TOP_LIMIT, Math.min(BOTTOM_LIMIT, s.y + (dy / n) * MOVE_SPEED * dt))

  s.distance += speed * dt
  s.score += Math.round(speed * dt * mult * 10) / 10

  // New asteroids at the top, and now and then a trail of stardust or a shield.
  s.spawnTimer -= dt * (s.boosting ? BOOST_FACTOR : 1)
  if (s.spawnTimer <= 0) {
    s.spawnTimer = spawnInterval(s.scroll) * (0.6 + s.rng() * 0.8)
    const r = 0.5 + s.rng() * s.rng() * 1.3
    s.rocks.push({ x: r + s.rng() * (W - 2 * r), y: -r - 0.5, r, vx: (s.rng() - 0.5) * 2.2, speed: 0.8 + s.rng() * 0.45, spin: s.rng() * 6, grazed: false })
  }
  s.dustTimer -= dt
  if (s.dustTimer <= 0) {
    s.dustTimer = 2.5 + s.rng() * 3
    // A gentle curve of seven specks.
    const x0 = 2 + s.rng() * (W - 4)
    const bend = (s.rng() - 0.5) * 6
    for (let k = 0; k < 7; k++) s.dust.push({ x: Math.max(0.5, Math.min(W - 0.5, x0 + Math.sin(k / 6 * Math.PI) * bend)), y: -1 - k * 1.1 })
  }
  if (!s.shield && !s.shieldPickup && s.rng() < SHIELD_CHANCE * dt) s.shieldPickup = { x: 1 + s.rng() * (W - 2), y: -1 }

  // Everything falls past.
  for (const rk of s.rocks) {
    rk.y += speed * rk.speed * dt
    rk.x += rk.vx * dt
    if (rk.x < rk.r || rk.x > W - rk.r) rk.vx = -rk.vx
    rk.spin += dt * 2
  }
  for (const d of s.dust) d.y += speed * dt
  if (s.shieldPickup) s.shieldPickup.y += speed * 0.7 * dt

  // Collisions.
  for (let i = s.rocks.length - 1; i >= 0; i--) {
    const rk = s.rocks[i]
    const gap = Math.hypot(rk.x - s.x, rk.y - s.y) - rk.r - COMET_R
    if (gap < 0) {
      s.rocks.splice(i, 1)
      if (s.invulnerable > 0) continue
      if (s.shield) {
        s.shield = false
        s.invulnerable = 0.6
        sounds.push('block')
        continue
      }
      s.lives--
      s.invulnerable = HIT_INVULNERABLE
      sounds.push('hit')
      if (s.lives <= 0) {
        s.phase = 'over'
        sounds.push('over')
        return sounds
      }
    }
    // Its closest approach while passing; once it's gone by, a whisker's clearance is a near miss (once per rock).
    if (Math.abs(rk.y - s.y) < rk.r + 2) rk.closest = Math.min(rk.closest ?? 99, gap)
    if (!rk.grazed && rk.y - rk.r > s.y + COMET_R && (rk.closest ?? 99) < NEAR_MISS && s.invulnerable <= 0) {
      rk.grazed = true
      const pts = 25 * mult
      s.score += pts
      s.popups.push({ x: s.x, y: s.y - 1, t: 0.8, text: `+${pts}` })
      sounds.push('whoosh')
    }
  }
  s.dust = s.dust.filter((d) => {
    if (Math.hypot(d.x - s.x, d.y - s.y) < COMET_R + DUST_R + 0.15) {
      s.score += 10 * mult
      sounds.push('dust')
      return false
    }
    return d.y < H + 1
  })
  if (s.shieldPickup) {
    if (Math.hypot(s.shieldPickup.x - s.x, s.shieldPickup.y - s.y) < COMET_R + 0.6) {
      s.shield = true
      s.shieldPickup = null
      sounds.push('shield')
    } else if (s.shieldPickup.y > H + 1) s.shieldPickup = null
  }
  s.rocks = s.rocks.filter((rk) => rk.y - rk.r < H + 1)
  s.score = Math.floor(s.score * 10) / 10
  return sounds
}
