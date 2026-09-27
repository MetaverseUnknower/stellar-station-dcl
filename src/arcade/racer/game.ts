// VOID RACER: the rules, and the road's perspective, as plain data and functions (no SDK), so they can be tested on
// their own. The scene (play.ts) feeds step() the player's input each frame, draws view() (hud.tsx) and plays the
// sounds step() reports.
//
// A pseudo-3D racer, the way the old cabinets did it: the road is a long run of short segments, each with a curve;
// the screen draws the next stretch of them, smaller and higher toward the horizon, shifted sideways by the curve so
// far. Hold the throttle to speed up; curves push you outward; off the road you slow right down. Dodge debris, pass
// the slower rival racers for a bonus, grab energy orbs for points and time. Reach each checkpoint before the clock
// runs out; each one adds time.
//
// Road units: x across (the road runs -1 to 1), z along it (segments are 1 long).

export const ROAD_HALF = 1
const MAX_SPEED = 62 // segments per second
const ACCEL = 26
const COAST = 9
const BRAKE = 55
const OFFROAD_MAX = 18
const STEER = 2.2 // road-widths per second at full speed
const CENTRIFUGAL = 0.34
const START_TIME = 45
const CHECKPOINT_EVERY = 1150 // segments
const CHECKPOINT_TIME = 21
const RIVAL_SPEED = 34
const DRAW = 90 // segments of road kept built ahead of the car

export type Thing = { z: number; x: number; kind: 'debris' | 'rival' | 'orb'; passed: boolean; hit: boolean }
export type Phase = 'title' | 'racing' | 'over'

export type State = {
  phase: Phase
  z: number // distance along the road
  x: number // across it
  speed: number
  time: number // left on the clock
  score: number
  checkpoint: number // next checkpoint's z
  curves: number[] // per segment
  things: Thing[]
  bump: number // seconds of shake after a hit
  flash: string | null // a message ("CHECKPOINT!") ...
  flashTime: number
  generated: number // road built up to this segment
  rng: () => number
}

export type Input = { left: boolean; right: boolean; throttle: boolean; brake: boolean; start: boolean }
export type Sound = 'engine' | 'crash' | 'orb' | 'pass' | 'checkpoint' | 'start' | 'over' | 'tick'

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

/** Build the road on ahead: sections of straight and eased curves; debris, rivals and orbs along them. */
function extend(s: State, upTo: number): void {
  while (s.generated < upTo) {
    const len = 40 + Math.floor(s.rng() * 80)
    const straight = s.rng() < 0.35
    const peak = straight ? 0 : (s.rng() < 0.5 ? -1 : 1) * (0.4 + s.rng() * 1.6) * 0.012
    for (let i = 0; i < len; i++) {
      const t = i / len
      s.curves.push(peak * Math.sin(Math.PI * t)) // ease in and out of the bend
    }
    // Things along it, thicker further on.
    const density = Math.min(0.09, 0.03 + s.generated / 40000)
    for (let i = 0; i < len; i += 6) {
      if (s.generated + i < 60) continue // a clear start
      const r = s.rng()
      if (r < density) s.things.push({ z: s.generated + i, x: (s.rng() - 0.5) * 1.6, kind: 'debris', passed: false, hit: false })
      else if (r < density * 1.8) s.things.push({ z: s.generated + i, x: (s.rng() - 0.5) * 1.4, kind: 'rival', passed: false, hit: false })
      else if (r < density * 2.4) s.things.push({ z: s.generated + i, x: (s.rng() - 0.5) * 1.5, kind: 'orb', passed: false, hit: false })
    }
    s.generated += len
  }
}

export function newGame(rng: () => number = Math.random): State {
  const s: State = {
    phase: 'title', z: 0, x: 0, speed: 0, time: START_TIME, score: 0, checkpoint: CHECKPOINT_EVERY, curves: [], things: [],
    bump: 0, flash: null, flashTime: 0, generated: 0, rng
  }
  extend(s, DRAW + 200)
  return s
}

const curveAt = (s: State, z: number) => s.curves[Math.max(0, Math.floor(z))] ?? 0

/** Advance the game by dt seconds; returns the sounds to play. */
export function step(s: State, input: Input, dt: number): Sound[] {
  const sounds: Sound[] = []
  dt = Math.min(dt, 0.05)
  s.flashTime = Math.max(0, s.flashTime - dt)
  if (s.phase !== 'racing') {
    if (input.start) {
      Object.assign(s, newGame(s.rng), { phase: 'racing' as Phase })
      sounds.push('start')
    }
    return sounds
  }
  s.bump = Math.max(0, s.bump - dt)

  // Throttle, brake, and the road's grip.
  const offroad = Math.abs(s.x) > ROAD_HALF
  if (input.brake) s.speed -= BRAKE * dt
  else if (input.throttle && s.bump <= 0) s.speed += ACCEL * dt * (1 - s.speed / (MAX_SPEED * 1.15))
  else s.speed -= COAST * dt
  if (offroad && s.speed > OFFROAD_MAX) s.speed -= 60 * dt
  s.speed = Math.max(0, Math.min(MAX_SPEED, s.speed))
  const f = s.speed / MAX_SPEED

  // Steering, and the curve throwing you outward.
  const steer = (input.right ? 1 : 0) - (input.left ? 1 : 0)
  s.x += steer * STEER * dt * (0.35 + 0.65 * f)
  s.x -= curveAt(s, s.z) * s.speed * CENTRIFUGAL * dt * f * 3
  s.x = Math.max(-2.2, Math.min(2.2, s.x))

  const before = s.z
  s.z += s.speed * dt
  s.score += Math.round(s.speed * dt)
  extend(s, s.z + DRAW + 200)

  // Things: rivals drive on; hits, passes and pickups.
  for (const t of s.things) {
    if (t.kind === 'rival') t.z += RIVAL_SPEED * dt
    if (t.hit || t.passed) continue
    if (t.z > before - 1 && t.z <= s.z + 0.6 && Math.abs(t.x - s.x) < (t.kind === 'orb' ? 0.32 : 0.36)) {
      t.hit = true
      if (t.kind === 'orb') {
        s.score += 50
        s.time += 0.5
        sounds.push('orb')
      } else {
        s.speed *= t.kind === 'rival' ? 0.45 : 0.25
        s.bump = 0.8
        if (t.kind === 'rival') t.z += 3 // shunted ahead
        sounds.push('crash')
      }
    } else if (t.kind === 'rival' && t.z < s.z - 1) {
      t.passed = true
      s.score += 100
      s.flash = '+100 PASS'
      s.flashTime = 0.8
      sounds.push('pass')
    }
  }
  s.things = s.things.filter((t) => t.z > s.z - 5 || (t.kind === 'rival' && !t.passed && t.z > s.z - 40))

  // The clock and the checkpoints.
  const secBefore = Math.ceil(s.time)
  s.time -= dt
  if (s.time <= 10 && Math.ceil(s.time) !== secBefore && s.time > 0) sounds.push('tick')
  if (s.z >= s.checkpoint) {
    s.checkpoint += CHECKPOINT_EVERY
    s.time += CHECKPOINT_TIME
    s.score += 500
    s.flash = 'CHECKPOINT!'
    s.flashTime = 1.5
    sounds.push('checkpoint')
  }
  if (s.time <= 0) {
    s.time = 0
    s.phase = 'over'
    sounds.push('over')
  }
  if (input.throttle && Math.floor(before / 12) !== Math.floor(s.z / 12)) sounds.push('engine')
  return sounds
}

// ---- the view ----------------------------------------------------------------------------------------------------

/** One screen row of road, between the horizon and the bottom: where it is (fractions of the view below the horizon),
 *  the road's centre and half-width there (in screen widths from the middle), and its stripe (for the rumble strips'
 *  alternation, which scrolls with the distance). */
export type Slice = { y: number; h: number; cx: number; half: number; stripe: boolean; checkpoint: boolean }
/** Something on the road, on screen: its centre, its size (fraction of the screen width), what it is. */
export type Sprite = { x: number; y: number; size: number; kind: Thing['kind'] }

export const ROWS = 64 // screen rows of road
const FAR = 90 // segments to the horizon row
const NEAR_HALF = 0.47 // the road's half-width at the bottom row, in screen widths
// A row a fraction f of the way down from the horizon sees the road K / f segments ahead (f = 1 at the bottom).
const K = FAR / ROWS
const scaleAt = (dz: number) => (NEAR_HALF * K) / dz // screen widths per road unit (half the road is 1 unit)

/** The road ahead as the camera sees it, drawn by screen row (the classic way: each row looks a set distance down
 *  the road, so the road lies flat and its stripes scroll smoothly), and the things on it, far to near. */
export function view(s: State): { slices: Slice[]; sprites: Sprite[]; bend: number } {
  // The road's sideways offset at each segment ahead, from the curves (its bend accumulates).
  const base = Math.floor(s.z)
  const frac = s.z - base
  const offsets: number[] = [0]
  let dx = 0
  let xOff = 0
  for (let i = 0; i <= FAR + 2; i++) {
    const c = curveAt(s, base + i)
    dx += c * (i === 0 ? 1 - frac : 1)
    xOff += dx
    offsets.push(xOff)
  }
  const offsetAt = (dz: number) => {
    const f = Math.max(0, Math.min(FAR + 1, dz + frac))
    const i = Math.floor(f)
    return offsets[i] + (offsets[i + 1] - offsets[i]) * (f - i)
  }
  const slices: Slice[] = []
  for (let r = 0; r < ROWS; r++) {
    const f = (r + 0.5) / ROWS // this row's middle, 0 at the horizon, 1 at the bottom
    const dz = K / f
    const scale = scaleAt(dz)
    const at = s.z + dz
    slices.push({
      y: r / ROWS,
      h: 1 / ROWS,
      cx: (offsetAt(dz) - s.x) * scale,
      half: ROAD_HALF * scale,
      stripe: Math.floor(at / 3) % 2 === 0,
      checkpoint: Math.abs(at - s.checkpoint) < dz * 0.08 + 0.5
    })
  }
  const sprites: Sprite[] = []
  for (const t of s.things) {
    if (t.hit) continue
    const dz = t.z - s.z
    if (dz < K || dz >= FAR) continue
    const scale = scaleAt(dz)
    sprites.push({ x: (offsetAt(dz) + t.x - s.x) * scale, y: K / dz, size: scale * (t.kind === 'orb' ? 0.3 : 0.6), kind: t.kind })
  }
  sprites.sort((a, b) => a.y - b.y) // far first
  return { slices, sprites, bend: curveAt(s, s.z) }
}
