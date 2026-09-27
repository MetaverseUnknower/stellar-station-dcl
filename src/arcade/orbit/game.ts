// ORBIT BLASTER: the rules, as plain data and functions (no SDK), so they can be tested on their own. The scene
// (play.ts) feeds step() the player's input each frame, draws the state (hud.tsx) and plays the sounds it reports.
//
// A planet in the middle; your ship orbits it, sliding round the ring, firing outward. Raiders pour in from deep
// space toward the planet: drifters straight in, weavers zigzagging, splitters that break in two when hit. Your shots
// only fly outward, so anything that slips inside your orbit can't be shot: it rams you if it meets you, and hits the
// planet's shield when it lands. Kills sometimes drop a rapid-fire pod to catch on your orbit. Waves grow and speed
// up. Out of ships, or out of shield, and it's over.
//
// Positions are polar about the field's centre (r in field units, a in radians); the field is S x S.

export const S = 22
export const PLANET_R = 2.1
export const ORBIT_R = 7.2
const SPAWN_R = 16.5 // beyond the corners of the view
const TURN_SPEED = 2.4 // radians per second round the orbit
const SHOT_SPEED = 17
const SHOT_EVERY = 0.2
const RAPID_EVERY = 0.08
const RAPID_SECONDS = 8
const SHIP_R = 0.55
export const START_SHIELD = 6
const START_LIVES = 3
const HIT_INVULNERABLE = 1.5
const POD_CHANCE = 0.08

export type Kind = 'drifter' | 'weaver' | 'splitter' | 'shard'
export const SIZE: Record<Kind, number> = { drifter: 0.55, weaver: 0.5, splitter: 0.75, shard: 0.38 }
const POINTS: Record<Kind, number> = { drifter: 10, weaver: 20, splitter: 30, shard: 10 }

export type Raider = { r: number; a: number; kind: Kind; speed: number; phase: number; hp: number; inside: boolean }
export type Shot = { r: number; a: number }
export type Pod = { r: number; a: number }
export type Phase = 'title' | 'playing' | 'between' | 'over'

export type State = {
  phase: Phase
  timer: number
  angle: number // the ship's, round the orbit
  score: number
  lives: number
  shield: number
  wave: number
  toSpawn: number // raiders still to come this wave
  spawnTimer: number
  raiders: Raider[]
  shots: Shot[]
  pods: Pod[]
  cooldown: number
  rapid: number
  invulnerable: number
  shieldFlash: number
  booms: { r: number; a: number; t: number; kind: Kind }[]
  rng: () => number
}

export type Input = { left: boolean; right: boolean; fire: boolean; start: boolean }
export type Sound = 'shoot' | 'pop' | 'brick' | 'hit' | 'block' | 'power' | 'wave' | 'start' | 'over'

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

/** Cartesian position (field units, origin top-left) of a polar point about the centre. */
export function xy(r: number, a: number): { x: number; y: number } {
  return { x: S / 2 + Math.cos(a) * r, y: S / 2 + Math.sin(a) * r }
}

const dist = (r1: number, a1: number, r2: number, a2: number) => {
  const p = xy(r1, a1)
  const q = xy(r2, a2)
  return Math.hypot(p.x - q.x, p.y - q.y)
}

const waveSize = (wave: number) => 6 + wave * 3

export function newGame(rng: () => number = Math.random): State {
  return {
    phase: 'title', timer: 0, angle: Math.PI / 2, score: 0, lives: START_LIVES, shield: START_SHIELD, wave: 1,
    toSpawn: waveSize(1), spawnTimer: 1.2, raiders: [], shots: [], pods: [], cooldown: 0, rapid: 0, invulnerable: 0,
    shieldFlash: 0, booms: [], rng
  }
}

function spawn(s: State): void {
  const roll = s.rng()
  const kind: Kind = s.wave >= 3 && roll < 0.25 ? 'splitter' : s.wave >= 2 && roll < 0.55 ? 'weaver' : 'drifter'
  const base = 2.2 + s.wave * 0.25
  s.raiders.push({ r: SPAWN_R, a: s.rng() * Math.PI * 2, kind, speed: base * (0.8 + s.rng() * 0.4), phase: s.rng() * 6, hp: kind === 'splitter' ? 2 : 1, inside: false })
}

/** Advance the game by dt seconds; returns the sounds to play. */
export function step(s: State, input: Input, dt: number): Sound[] {
  const sounds: Sound[] = []
  dt = Math.min(dt, 0.05)
  s.booms = s.booms.filter((b) => (b.t -= dt) > 0)
  s.shieldFlash = Math.max(0, s.shieldFlash - dt)
  if (s.phase === 'title' || s.phase === 'over') {
    if (input.start) {
      Object.assign(s, newGame(s.rng), { phase: 'playing' as Phase })
      sounds.push('start')
    }
    return sounds
  }
  if (s.phase === 'between') {
    s.timer -= dt
    if (s.timer <= 0) {
      s.wave++
      s.toSpawn = waveSize(s.wave)
      s.spawnTimer = 1
      s.phase = 'playing'
      s.shield = Math.min(START_SHIELD, s.shield + 1) // a little repair between waves
      sounds.push('wave')
    }
    return sounds
  }

  s.invulnerable = Math.max(0, s.invulnerable - dt)
  s.rapid = Math.max(0, s.rapid - dt)

  // The ship round the orbit: right is clockwise as you look at it (screen y is down, so angle increases).
  s.angle += ((input.right ? 1 : 0) - (input.left ? 1 : 0)) * TURN_SPEED * dt
  s.cooldown -= dt
  if (input.fire && s.cooldown <= 0) {
    s.shots.push({ r: ORBIT_R + SHIP_R, a: s.angle })
    s.cooldown = s.rapid > 0 ? RAPID_EVERY : SHOT_EVERY
    sounds.push('shoot')
  }

  // Raiders arrive over the wave.
  if (s.toSpawn > 0) {
    s.spawnTimer -= dt
    if (s.spawnTimer <= 0) {
      spawn(s)
      s.toSpawn--
      s.spawnTimer = Math.max(0.35, 1.3 - s.wave * 0.08) * (0.6 + s.rng() * 0.8)
    }
  }

  // Move everything.
  for (const sh of s.shots) sh.r += SHOT_SPEED * dt
  s.shots = s.shots.filter((sh) => sh.r < SPAWN_R)
  for (const rd of s.raiders) {
    rd.r -= rd.speed * dt
    rd.phase += dt
    if (rd.kind === 'weaver') rd.a += Math.sin(rd.phase * 3) * 1.1 * dt * (7 / Math.max(3, rd.r))
    else if (rd.kind === 'shard') rd.a += Math.sin(rd.phase * 5) * 0.6 * dt
    if (rd.r < ORBIT_R - 0.4) rd.inside = true
  }
  for (const p of s.pods) p.r -= 2.2 * dt

  // Shots hit raiders still outside the orbit.
  for (const sh of s.shots) {
    for (const rd of s.raiders) {
      if (rd.hp <= 0 || rd.inside) continue
      if (dist(sh.r, sh.a, rd.r, rd.a) > SIZE[rd.kind] + 0.25) continue
      sh.r = 999
      rd.hp--
      if (rd.hp > 0) { sounds.push('brick'); break }
      s.score += POINTS[rd.kind] * s.wave
      s.booms.push({ r: rd.r, a: rd.a, t: 0.35, kind: rd.kind })
      sounds.push('pop')
      if (rd.kind === 'splitter') {
        for (const da of [-0.18, 0.18]) s.raiders.push({ r: rd.r + 0.4, a: rd.a + da, kind: 'shard', speed: rd.speed * 1.25, phase: s.rng() * 6, hp: 1, inside: false })
      }
      if (s.rng() < POD_CHANCE) s.pods.push({ r: rd.r, a: rd.a })
      break
    }
  }
  s.shots = s.shots.filter((sh) => sh.r < SPAWN_R)

  // Raiders meeting the ship on its orbit, and landing on the planet.
  for (const rd of s.raiders) {
    if (rd.hp <= 0) continue
    if (s.invulnerable <= 0 && Math.abs(rd.r - ORBIT_R) < 1 && dist(rd.r, rd.a, ORBIT_R, s.angle) < SIZE[rd.kind] + SHIP_R) {
      rd.hp = 0
      s.booms.push({ r: rd.r, a: rd.a, t: 0.35, kind: rd.kind })
      s.lives--
      s.invulnerable = HIT_INVULNERABLE
      sounds.push('hit')
      continue
    }
    if (rd.r <= PLANET_R + SIZE[rd.kind]) {
      rd.hp = 0
      s.shield--
      s.shieldFlash = 0.5
      s.booms.push({ r: PLANET_R + 0.4, a: rd.a, t: 0.35, kind: rd.kind })
      sounds.push('block')
    }
  }
  s.raiders = s.raiders.filter((rd) => rd.hp > 0)

  // Pods caught on the orbit.
  s.pods = s.pods.filter((p) => {
    if (Math.abs(p.r - ORBIT_R) < 0.9 && dist(p.r, p.a, ORBIT_R, s.angle) < SHIP_R + 0.6) {
      s.rapid = RAPID_SECONDS
      sounds.push('power')
      return false
    }
    return p.r > PLANET_R
  })

  if (s.lives <= 0 || s.shield <= 0) {
    s.phase = 'over'
    sounds.push('over')
  } else if (s.toSpawn === 0 && s.raiders.length === 0) {
    s.phase = 'between'
    s.timer = 2.2
    s.shots = []
  }
  return sounds
}
