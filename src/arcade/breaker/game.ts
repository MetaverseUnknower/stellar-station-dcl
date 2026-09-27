// NEBULA BREAKER: the rules, as plain data and functions (no SDK), so they can be tested on their own. The scene
// (play.ts) feeds step() the player's input each frame, draws the state (hud.tsx) and plays the sounds it reports.
//
// A brick-breaker: bounce a comet off your paddle to blast apart banks of nebula clouds. Where the comet meets the
// paddle sets its angle. Broken clouds sometimes drop a power-up to catch: a wide paddle, a multi-ball split, or slow
// motion. Later levels have two-hit clouds and asteroids that don't break. Clear every breakable cloud to go on;
// lose every comet and you lose a life.
//
// Units are field cells: the field is W x H, y downward from the top.

export const W = 20
export const H = 24
export const PADDLE_Y = 22.4
export const PADDLE_H = 0.45
const PADDLE_W = 3.2
const WIDE_W = 5.2
const PADDLE_SPEED = 17
export const BALL_R = 0.28
const BALL_SPEED = 11
const MAX_SPEED = 17.5
const SPEEDUP = 0.12 // per brick broken
const SLOW_FACTOR = 0.6
const POWER_SECONDS = 12
const POWER_CHANCE = 0.12
const POWER_FALL = 5
export const BRICK_W = 2.2
export const BRICK_H = 0.8
const BRICK_GAP = 0.15
export const COLS = 8
const TOP = 2.2
const START_LIVES = 3
const MAX_BALLS = 4

export type Brick = { x: number; y: number; hp: number; row: number; steel: boolean }
export type Ball = { x: number; y: number; vx: number; vy: number; stuck: boolean }
export type PowerKind = 'wide' | 'multi' | 'slow'
export type Power = { x: number; y: number; kind: PowerKind }
export type Phase = 'title' | 'playing' | 'lost' | 'cleared' | 'over'

export type State = {
  phase: Phase
  timer: number
  score: number
  lives: number
  level: number
  paddleX: number // centre
  paddleW: number
  balls: Ball[]
  bricks: Brick[]
  powers: Power[]
  wide: number // seconds of each power left
  slow: number
  speed: number
  popped: { x: number; y: number; t: number; row: number }[]
  rng: () => number
}

export type Input = { left: boolean; right: boolean; launch: boolean }
export type Sound = 'bounce' | 'brick' | 'tick' | 'power' | 'hit' | 'start' | 'over' | 'wave' | 'launch'

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

// Level layouts, one character per brick (8 across): '.' none, '1' one hit, '2' two hits, '#' asteroid (unbreakable).
const LAYOUTS: string[][] = [
  ['11111111', '11111111', '11111111', '11111111', '11111111'],
  ['1.1.1.1.', '.1.1.1.1', '21212121', '.1.1.1.1', '1.1.1.1.', '22222222'],
  ['...22...', '..2112..', '.211112.', '21111112', '#1.##.1#', '11111111'],
  ['2#2222#2', '21111112', '21#11#12', '21111112', '22222222', '1.1..1.1'],
  ['11#11#11', '2.2..2.2', '12211221', '#2.22.2#', '11111111', '22222222']
]

function makeBricks(level: number): Brick[] {
  const layout = LAYOUTS[(level - 1) % LAYOUTS.length]
  const tougher = Math.floor((level - 1) / LAYOUTS.length) // after the last layout, round again with more hits
  const left = (W - (COLS * BRICK_W + (COLS - 1) * BRICK_GAP)) / 2
  const out: Brick[] = []
  layout.forEach((row, r) => {
    for (let c = 0; c < COLS; c++) {
      const ch = row[c]
      if (ch === '.') continue
      const steel = ch === '#'
      out.push({ x: left + c * (BRICK_W + BRICK_GAP), y: TOP + r * (BRICK_H + BRICK_GAP), hp: steel ? 1 : Number(ch) + tougher, row: r, steel })
    }
  })
  return out
}

const newBall = (s: State): Ball => ({ x: s.paddleX, y: PADDLE_Y - BALL_R - 0.02, vx: 0, vy: 0, stuck: true })

export function newGame(rng: () => number = Math.random): State {
  const s: State = {
    phase: 'title', timer: 0, score: 0, lives: START_LIVES, level: 1, paddleX: W / 2, paddleW: PADDLE_W,
    balls: [], bricks: makeBricks(1), powers: [], wide: 0, slow: 0, speed: BALL_SPEED, popped: [], rng
  }
  s.balls = [newBall(s)]
  return s
}

function startLevel(s: State, level: number): void {
  s.level = level
  s.bricks = makeBricks(level)
  s.powers = []
  s.wide = 0
  s.slow = 0
  s.speed = BALL_SPEED + (level - 1) * 0.6
  s.balls = [newBall(s)]
}

function launch(s: State, b: Ball): void {
  const a = (-90 + (s.rng() - 0.5) * 50) * (Math.PI / 180) // mostly up
  b.vx = Math.cos(a) * s.speed
  b.vy = Math.sin(a) * s.speed
  b.stuck = false
}

function setSpeed(b: Ball, speed: number): void {
  const v = Math.hypot(b.vx, b.vy) || 1
  b.vx = (b.vx / v) * speed
  b.vy = (b.vy / v) * speed
  // Never too flat: keep at least a fifth of the speed up or down, or it can bounce side to side for ages.
  if (Math.abs(b.vy) < speed * 0.2) {
    b.vy = Math.sign(b.vy || -1) * speed * 0.2
    b.vx = Math.sign(b.vx || 1) * Math.sqrt(speed * speed - b.vy * b.vy)
  }
}

/** Advance the game by dt seconds; returns the sounds to play. */
export function step(s: State, input: Input, dt: number): Sound[] {
  const sounds: Sound[] = []
  dt = Math.min(dt, 0.05)
  s.popped = s.popped.filter((p) => (p.t -= dt) > 0)

  if (s.phase === 'title' || s.phase === 'over') {
    if (input.launch) {
      Object.assign(s, newGame(s.rng), { phase: 'playing' as Phase })
      sounds.push('start')
    }
    return sounds
  }
  if (s.phase === 'lost' || s.phase === 'cleared') {
    s.timer -= dt
    if (s.timer > 0) return sounds
    if (s.phase === 'cleared') {
      startLevel(s, s.level + 1)
      sounds.push('wave')
    } else if (s.lives <= 0) {
      s.phase = 'over'
      sounds.push('over')
      return sounds
    } else {
      s.balls = [newBall(s)]
      s.wide = 0
      s.slow = 0
    }
    s.phase = 'playing'
    return sounds
  }

  // Powers wear off.
  s.wide = Math.max(0, s.wide - dt)
  s.slow = Math.max(0, s.slow - dt)
  s.paddleW = s.wide > 0 ? WIDE_W : PADDLE_W

  // The paddle.
  const move = (input.right ? 1 : 0) - (input.left ? 1 : 0)
  s.paddleX = Math.max(s.paddleW / 2, Math.min(W - s.paddleW / 2, s.paddleX + move * PADDLE_SPEED * dt))
  for (const b of s.balls) {
    if (!b.stuck) continue
    b.x = s.paddleX
    b.y = PADDLE_Y - BALL_R - 0.02
    if (input.launch) {
      launch(s, b)
      sounds.push('launch')
    }
  }

  // The comets, in small sub-steps so a fast one can't pass through a cloud.
  const speed = s.speed * (s.slow > 0 ? SLOW_FACTOR : 1)
  for (const b of s.balls) if (!b.stuck) setSpeed(b, speed)
  const steps = Math.max(1, Math.ceil((speed * dt) / 0.15))
  const h = dt / steps
  for (let k = 0; k < steps; k++) {
    for (const b of s.balls) {
      if (b.stuck) continue
      b.x += b.vx * h
      b.y += b.vy * h
      // Walls and ceiling.
      if (b.x < BALL_R) { b.x = BALL_R; b.vx = Math.abs(b.vx); sounds.push('tick') }
      if (b.x > W - BALL_R) { b.x = W - BALL_R; b.vx = -Math.abs(b.vx); sounds.push('tick') }
      if (b.y < BALL_R) { b.y = BALL_R; b.vy = Math.abs(b.vy); sounds.push('tick') }
      // The paddle: the angle comes from where it lands (-65 to +65 degrees from straight up).
      const left = s.paddleX - s.paddleW / 2
      if (b.vy > 0 && b.y + BALL_R >= PADDLE_Y && b.y + BALL_R <= PADDLE_Y + PADDLE_H + 0.3 && b.x >= left - BALL_R && b.x <= left + s.paddleW + BALL_R) {
        const f = Math.max(-1, Math.min(1, (b.x - s.paddleX) / (s.paddleW / 2)))
        const a = (-90 + f * 65) * (Math.PI / 180)
        b.vx = Math.cos(a) * speed
        b.vy = Math.sin(a) * speed
        b.y = PADDLE_Y - BALL_R
        sounds.push('bounce')
      }
      // Clouds: the first one it overlaps, bouncing off the side it came through.
      for (let i = 0; i < s.bricks.length; i++) {
        const br = s.bricks[i]
        const nx = Math.max(br.x, Math.min(b.x, br.x + BRICK_W))
        const ny = Math.max(br.y, Math.min(b.y, br.y + BRICK_H))
        if ((b.x - nx) ** 2 + (b.y - ny) ** 2 > BALL_R * BALL_R) continue
        const overlapX = Math.min(b.x + BALL_R - br.x, br.x + BRICK_W - (b.x - BALL_R))
        const overlapY = Math.min(b.y + BALL_R - br.y, br.y + BRICK_H - (b.y - BALL_R))
        if (overlapX < overlapY) {
          b.vx = b.x < br.x + BRICK_W / 2 ? -Math.abs(b.vx) : Math.abs(b.vx)
          b.x += b.vx > 0 ? overlapX : -overlapX
        } else {
          b.vy = b.y < br.y + BRICK_H / 2 ? -Math.abs(b.vy) : Math.abs(b.vy)
          b.y += b.vy > 0 ? overlapY : -overlapY
        }
        if (br.steel) {
          sounds.push('tick')
        } else if (--br.hp > 0) {
          s.score += 5
          sounds.push('tick')
        } else {
          s.bricks.splice(i, 1)
          s.score += 10 * (br.row < 2 ? 3 : br.row < 4 ? 2 : 1) * s.level
          s.speed = Math.min(MAX_SPEED, s.speed + SPEEDUP)
          s.popped.push({ x: br.x + BRICK_W / 2, y: br.y + BRICK_H / 2, t: 0.3, row: br.row })
          sounds.push('brick')
          if (s.rng() < POWER_CHANCE) {
            const kinds: PowerKind[] = ['wide', 'multi', 'slow']
            s.powers.push({ x: br.x + BRICK_W / 2, y: br.y + BRICK_H / 2, kind: kinds[Math.floor(s.rng() * kinds.length)] })
          }
        }
        break
      }
    }
  }

  // Power-ups falling; caught by the paddle.
  s.powers = s.powers.filter((p) => {
    p.y += POWER_FALL * dt
    const caught = p.y >= PADDLE_Y - 0.3 && p.y <= PADDLE_Y + PADDLE_H && Math.abs(p.x - s.paddleX) <= s.paddleW / 2 + 0.4
    if (caught) {
      sounds.push('power')
      if (p.kind === 'wide') s.wide = POWER_SECONDS
      else if (p.kind === 'slow') s.slow = POWER_SECONDS
      else {
        const src = s.balls.find((b) => !b.stuck) ?? s.balls[0]
        for (const turn of [-25, 25]) {
          if (s.balls.length >= MAX_BALLS) break
          const a = Math.atan2(src.vy || -1, src.vx) + (turn * Math.PI) / 180
          s.balls.push({ x: src.x, y: src.y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, stuck: src.stuck })
        }
      }
      return false
    }
    return p.y < H
  })

  // Comets lost off the bottom.
  s.balls = s.balls.filter((b) => b.y - BALL_R < H)
  if (s.balls.length === 0) {
    s.lives -= 1
    s.phase = 'lost'
    s.timer = 1.4
    s.powers = []
    sounds.push('hit')
  } else if (!s.bricks.some((b) => !b.steel)) {
    s.phase = 'cleared'
    s.timer = 2
    s.powers = []
  }
  return sounds
}
