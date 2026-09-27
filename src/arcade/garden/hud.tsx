// ASTRO GARDEN's screen, drawn in the HUD while the player is at the cabinet: the garden bed (every sprite a few
// solid boxes), a score bar on top, the controls underneath.
import ReactEcs, { UiEntity, Label } from '@dcl/sdk/react-ecs'
import { Color4 } from '@dcl/sdk/math'
import { px } from '../../uiScale'
import { W, H, SEED_POINTS, GOLDEN_POINTS } from './game'
import { garden, isPlayingGarden, gardenHiScore, gardenBest, quitGarden } from './play'

const U = 26 // pixels per cell (at 1080p)
const BG = Color4.create(0.03, 0.02, 0.05, 0.96)
const SOIL = Color4.create(0.09, 0.06, 0.1, 1)
const SOIL_DOT = Color4.create(0.13, 0.09, 0.14, 1)
const FRAME = Color4.create(0.35, 0.9, 0.45, 1)
const VINE = Color4.create(0.3, 0.85, 0.35, 1)
const VINE_DARK = Color4.create(0.16, 0.55, 0.22, 1)
const HEAD = Color4.create(0.55, 1, 0.5, 1)
const DARK = Color4.create(0.02, 0.02, 0.04, 1)
const SEED = Color4.create(1, 0.92, 0.45, 1)
const GOLD = Color4.create(1, 0.72, 0.1, 1)
const ROCK = Color4.create(0.45, 0.43, 0.5, 1)
const ROCK_DARK = Color4.create(0.3, 0.28, 0.34, 1)
const CYAN = Color4.create(0.2, 0.9, 1, 1)
const PINK = Color4.create(1, 0.22, 0.7, 1)
const DIM = Color4.create(0.6, 0.6, 0.8, 1)
const WHITE = Color4.White()
const BLOOMS = [PINK, Color4.create(0.7, 0.45, 1, 1), Color4.create(1, 0.6, 0.2, 1), Color4.create(0.4, 0.8, 1, 1), GOLD]

function box(key: string, x: number, y: number, w: number, h: number, color: Color4) {
  return (
    <UiEntity
      key={key}
      uiTransform={{ positionType: 'absolute', position: { left: px(x * U), top: px(y * U) }, width: px(w * U), height: px(h * U) }}
      uiBackground={{ color }}
    />
  )
}

function text(key: string, value: string, y: number, size: number, color: Color4) {
  return (
    <UiEntity key={key} uiTransform={{ positionType: 'absolute', position: { left: 0, top: px(y * U) }, width: px(W * U), height: px(size * 1.4) }}>
      <Label value={value} fontSize={px(size)} color={color} textAlign="middle-center" uiTransform={{ width: '100%', height: '100%' }} />
    </UiEntity>
  )
}

/** A star seed: a bright core with four short rays; golden ones bigger, pulsing. */
function seed(key: string, x: number, y: number, color: Color4, grow = 0) {
  const c = 0.5
  const r = 0.16 + grow
  return [
    box(`${key}c`, x + c - r, y + c - r, 2 * r, 2 * r, color),
    box(`${key}h`, x + 0.12 - grow, y + c - 0.05, 0.76 + 2 * grow, 0.1, color),
    box(`${key}v`, x + c - 0.05, y + 0.12 - grow, 0.1, 0.76 + 2 * grow, color)
  ]
}

function Bed() {
  const s = garden()
  const out: ReturnType<typeof box>[] = []
  // Soil, with a scatter of darker specks (fixed, so it doesn't shimmer).
  out.push(box('soil', 0, 0, W, H, SOIL))
  for (let i = 0; i < 60; i++) out.push(box(`d${i}`, (i * 7.3) % W, (i * 4.7) % H, 0.14, 0.14, SOIL_DOT))
  if (s.phase === 'title') return <UiEntity uiTransform={{ width: px(W * U), height: px(H * U) }}>{out}</UiEntity>

  s.rocks.forEach((r, i) => {
    out.push(box(`r${i}`, r.x + 0.08, r.y + 0.12, 0.84, 0.76, ROCK))
    out.push(box(`r${i}s`, r.x + 0.25, r.y + 0.3, 0.25, 0.2, ROCK_DARK))
  })
  out.push(...seed('seed', s.seed.x, s.seed.y, SEED))
  if (s.golden) {
    const pulse = 0.06 * Math.sin(Date.now() / 120)
    const fading = s.golden.left < 2 && Math.floor(Date.now() / 150) % 2 === 0
    if (!fading) out.push(...seed('gold', s.golden.x, s.golden.y, GOLD, 0.06 + pulse))
  }
  // The vine: tail to head, so the head draws on top. Segments joined by a narrower link toward the next.
  for (let i = s.vine.length - 1; i >= 0; i--) {
    const v = s.vine[i]
    const isHead = i === 0
    out.push(box(`v${i}`, v.x + 0.1, v.y + 0.1, 0.8, 0.8, isHead ? HEAD : i % 2 ? VINE : VINE_DARK))
    const n = s.vine[i - 1]
    if (n) {
      const dx = n.x - v.x
      const dy = n.y - v.y
      out.push(box(`l${i}`, v.x + 0.3 + dx * 0.5, v.y + 0.3 + dy * 0.5, 0.4, 0.4, VINE))
    }
    if (v.bloom) {
      const col = BLOOMS[(v.bloom - 1) % BLOOMS.length]
      out.push(box(`b${i}a`, v.x + 0.2, v.y + 0.35, 0.6, 0.3, col))
      out.push(box(`b${i}b`, v.x + 0.35, v.y + 0.2, 0.3, 0.6, col))
      out.push(box(`b${i}c`, v.x + 0.42, v.y + 0.42, 0.16, 0.16, SEED))
    }
    if (isHead) {
      // Eyes, looking the way it's going.
      const lx = s.dir === 'left' ? -0.12 : s.dir === 'right' ? 0.12 : 0
      const ly = s.dir === 'up' ? -0.12 : s.dir === 'down' ? 0.12 : 0
      const across = s.dir === 'up' || s.dir === 'down'
      for (const k of [-1, 1]) {
        const ex = v.x + 0.5 + lx + (across ? k * 0.18 : 0) - 0.08
        const ey = v.y + 0.5 + ly + (across ? 0 : k * 0.18) - 0.08
        out.push(box(`e${k}`, ex, ey, 0.16, 0.16, DARK))
      }
    }
  }
  if (s.crashed) {
    const c = s.crashed
    out.push(box('x1', Math.max(0, Math.min(W - 1, c.x)) + 0.1, Math.max(0, Math.min(H - 1, c.y)) + 0.45, 0.8, 0.1, PINK))
    out.push(box('x2', Math.max(0, Math.min(W - 1, c.x)) + 0.45, Math.max(0, Math.min(H - 1, c.y)) + 0.1, 0.1, 0.8, PINK))
  }
  return <UiEntity uiTransform={{ width: px(W * U), height: px(H * U) }}>{out}</UiEntity>
}

function Overlay() {
  const s = garden()
  const hi = gardenHiScore()
  const blink = Math.floor(Date.now() / 500) % 2 === 0
  const layer = (children: any[]) => (
    <UiEntity uiTransform={{ positionType: 'absolute', position: { left: 0, top: 0 }, width: px(W * U), height: px(H * U) }}>{children}</UiEntity>
  )
  if (s.phase === 'title') {
    return layer([
      text('t1', 'ASTRO GARDEN', 2.2, 44, FRAME),
      text('t2', 'Grow your vine across the garden bed', 4.6, 17, DIM),
      ...seed('ts', W / 2 - 4.5, 7.5, SEED),
      text('t3', `      star seed   ${SEED_POINTS} x level`, 7.3, 18, WHITE),
      ...seed('tg', W / 2 - 4.5, 9.3, GOLD, 0.08),
      text('t4', `      golden seed   ${GOLDEN_POINTS} x level, if you're quick`, 9.1, 18, WHITE),
      text('t5', 'Every seed makes you longer. Miss the edges, the rocks, and yourself.', 11.4, 15, DIM),
      blink ? text('t6', 'PRESS  E  OR  SPACE  TO  START', 14, 22, CYAN) : null,
      hi.score > 0 ? text('t7', `STATION HIGH SCORE  ${hi.score}  ${hi.name}`, 16, 16, GOLD) : null
    ].filter(Boolean))
  }
  if (s.phase === 'over') {
    const best = s.score > 0 && s.score >= hi.score
    return layer([
      text('o1', 'WILTED', 5.5, 46, PINK),
      text('o2', `SCORE  ${s.score}     LENGTH  ${s.vine.length}`, 8.6, 24, WHITE),
      best ? text('o3', 'NEW STATION HIGH SCORE!', 10.6, 22, GOLD) : null,
      blink ? text('o4', 'E / SPACE  PLAY AGAIN     F  LEAVE', 13.5, 20, CYAN) : null
    ].filter(Boolean))
  }
  return null
}

function ScoreBar() {
  const s = garden()
  const hi = gardenHiScore()
  const cell = (key: string, label: string, value: string, color: Color4) => (
    <UiEntity key={key} uiTransform={{ flexDirection: 'column', alignItems: 'center', width: px((W * U) / 4) }}>
      <Label value={label} fontSize={px(13)} color={DIM} />
      <Label value={value} fontSize={px(22)} color={color} />
    </UiEntity>
  )
  return (
    <UiEntity uiTransform={{ flexDirection: 'row', width: px(W * U), height: px(56), margin: { bottom: px(6) } }}>
      {cell('score', 'SCORE', `${s.score}`, WHITE)}
      {cell('hi', 'STATION HI', hi.score > 0 ? `${hi.score}` : '-', GOLD)}
      {cell('level', 'LEVEL', `${s.level}`, CYAN)}
      {cell('length', 'LENGTH', `${s.vine.length}`, FRAME)}
    </UiEntity>
  )
}

export function GardenScreen() {
  if (!isPlayingGarden()) return null
  const best = gardenBest()
  return (
    <UiEntity uiTransform={{ positionType: 'absolute', width: '100%', height: '100%', justifyContent: 'center', alignItems: 'center' }}>
      <UiEntity
        uiTransform={{ flexDirection: 'column', alignItems: 'center', padding: px(16), borderWidth: px(3), borderColor: FRAME }}
        uiBackground={{ color: BG }}
      >
        <ScoreBar />
        <UiEntity uiTransform={{ width: px(W * U), height: px(H * U) }}>
          <Bed />
          <Overlay />
        </UiEntity>
        <UiEntity uiTransform={{ flexDirection: 'row', width: px(W * U), height: px(40), margin: { top: px(8) }, justifyContent: 'space-between', alignItems: 'center' }}>
          <Label value={`ARROWS / WASD  (or 1-4)  STEER${best > 0 ? `    BEST ${best}` : ''}`} fontSize={px(14)} color={DIM} textAlign="middle-left" />
          <UiEntity
            uiTransform={{ padding: { left: px(12), right: px(12) }, height: px(32), alignItems: 'center' }}
            uiBackground={{ color: Color4.create(1, 1, 1, 0.08) }}
            onMouseDown={() => quitGarden()}
          >
            <Label value="F  LEAVE" fontSize={px(14)} color={CYAN} />
          </UiEntity>
        </UiEntity>
      </UiEntity>
    </UiEntity>
  )
}
