// STAR DRIFT's screen, drawn in the HUD while the player is at the cabinet: the moon's surface as columns of rock,
// the pads with their multipliers, the lander with its flames, and gauges for fuel and speed.
import ReactEcs, { UiEntity, Label } from '@dcl/sdk/react-ecs'
import { Color4 } from '@dcl/sdk/math'
import { px } from '../../uiScale'
import { W, H, SHIP_W, SHIP_H } from './game'
import { drift, isPlayingDrift, driftHiScore, driftBest, quitDrift } from './play'

const U = 24 // pixels per field unit (at 1080p)
const BG = Color4.create(0.01, 0.01, 0.04, 0.96)
const FRAME = Color4.create(0.75, 0.85, 1, 1)
const CYAN = Color4.create(0.2, 0.9, 1, 1)
const PINK = Color4.create(1, 0.22, 0.7, 1)
const AMBER = Color4.create(1, 0.7, 0.15, 1)
const GREEN = Color4.create(0.35, 1, 0.5, 1)
const DIM = Color4.create(0.6, 0.6, 0.8, 1)
const WHITE = Color4.White()
const ROCK = Color4.create(0.32, 0.3, 0.38, 1)
const ROCK_TOP = Color4.create(0.52, 0.5, 0.58, 1)
const PAD = Color4.create(0.2, 0.9, 1, 1)
const HULL = Color4.create(0.85, 0.88, 0.95, 1)
const COLUMNS = 80 // drawn slices of ground

function box(key: string, x: number, y: number, w: number, h: number, color: Color4) {
  return (
    <UiEntity
      key={key}
      uiTransform={{ positionType: 'absolute', position: { left: px(x * U), top: px(y * U) }, width: px(w * U), height: px(h * U) }}
      uiBackground={{ color }}
    />
  )
}

function label(key: string, value: string, x: number, y: number, w: number, size: number, color: Color4) {
  return (
    <UiEntity key={key} uiTransform={{ positionType: 'absolute', position: { left: px(x * U), top: px(y * U) }, width: px(w * U), height: px(size * 1.4) }}>
      <Label value={value} fontSize={px(size)} color={color} textAlign="middle-center" uiTransform={{ width: '100%', height: '100%' }} />
    </UiEntity>
  )
}

/** The lander, its bottom at (x, y): a hull, a cockpit, legs, and flames where it's burning. */
function lander(key: string, x: number, y: number, thrust: { main: boolean; left: boolean; right: boolean }, colour: Color4) {
  const out = [
    box(`${key}h`, x - SHIP_W / 2 + 0.1, y - SHIP_H, SHIP_W - 0.2, SHIP_H * 0.6, colour),
    box(`${key}c`, x - 0.18, y - SHIP_H - 0.2, 0.36, 0.28, CYAN),
    box(`${key}l`, x - SHIP_W / 2, y - 0.35, 0.1, 0.35, colour),
    box(`${key}r`, x + SHIP_W / 2 - 0.1, y - 0.35, 0.1, 0.35, colour),
    box(`${key}f`, x - SHIP_W / 2 - 0.1, y - 0.05, 0.3, 0.06, colour),
    box(`${key}g`, x + SHIP_W / 2 - 0.2, y - 0.05, 0.3, 0.06, colour)
  ]
  const flicker = 0.7 + 0.3 * Math.sin(Date.now() / 30)
  if (thrust.main) {
    out.push(box(`${key}m1`, x - 0.2, y - 0.35, 0.4, 0.5 * flicker + 0.2, AMBER))
    out.push(box(`${key}m2`, x - 0.1, y - 0.2, 0.2, 0.7 * flicker + 0.2, Color4.create(1, 0.95, 0.6, 1)))
  }
  // A thruster on the right pushes left, and the other way round.
  if (thrust.left) out.push(box(`${key}tl`, x + SHIP_W / 2 - 0.1, y - SHIP_H * 0.75, 0.4 * flicker, 0.18, AMBER))
  if (thrust.right) out.push(box(`${key}tr`, x - SHIP_W / 2 + 0.1 - 0.4 * flicker, y - SHIP_H * 0.75, 0.4 * flicker, 0.18, AMBER))
  return out
}

function Field() {
  const s = drift()
  const out: ReturnType<typeof box>[] = []
  for (let i = 0; i < 45; i++) out.push(box(`st${i}`, (i * 7.3) % W, (i * 3.9) % 13, 0.08, 0.08, Color4.create(1, 1, 1, 0.3 + (i % 3) * 0.2)))
  // A planet low in the sky.
  out.push(box('pl', 15, 3, 3, 3, Color4.create(0.5, 0.35, 0.9, 0.5)))
  out.push(box('pl2', 15.5, 2.6, 2, 3.8, Color4.create(0.5, 0.35, 0.9, 0.5)))
  // The ground: columns of rock from the surface down, a lighter crust on top.
  const cw = W / COLUMNS
  const at = (x: number) => {
    const n = s.ground.length - 1
    const f = Math.max(0, Math.min(n, (x / W) * n))
    const i = Math.min(n - 1, Math.floor(f))
    return s.ground[i] + (s.ground[i + 1] - s.ground[i]) * (f - i)
  }
  for (let c = 0; c < COLUMNS; c++) {
    const y = at((c + 0.5) * cw)
    out.push(box(`g${c}`, c * cw, y, cw + 0.02, H - y, ROCK))
    out.push(box(`gt${c}`, c * cw, y, cw + 0.02, 0.15, ROCK_TOP))
  }
  s.pads.forEach((p, i) => {
    const blink = s.phase === 'flying' && Math.floor(Date.now() / 400 + i) % 2 === 0
    out.push(box(`p${i}`, p.x0, p.y - 0.1, p.x1 - p.x0, 0.2, PAD))
    out.push(box(`pl${i}`, p.x0, p.y - 0.5, 0.08, 0.4, blink ? PINK : AMBER))
    out.push(box(`pr${i}`, p.x1 - 0.08, p.y - 0.5, 0.08, 0.4, blink ? PINK : AMBER))
    out.push(label(`pm${i}`, `x${p.mult}`, p.x0 - 1, p.y + 0.3, p.x1 - p.x0 + 2, 15, WHITE))
  })
  if (s.phase === 'title') return <UiEntity uiTransform={{ width: px(W * U), height: px(H * U) }}>{out}</UiEntity>

  if (s.phase === 'crashed') {
    // Debris flying out.
    const k = 1.8 - s.timer
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2
      out.push(box(`x${i}`, s.x + Math.cos(a) * k * 2, s.y - 0.4 + Math.sin(a) * k * 1.5 - k, 0.2, 0.2, i % 2 ? AMBER : PINK))
    }
  } else {
    out.push(...lander('ship', s.x, s.y, s.thrusting, HULL))
  }
  // Wind: an arrow along the top.
  if (Math.abs(s.wind) > 0.05) out.push(label('wind', s.wind > 0 ? `WIND  >>>` : `<<<  WIND`, 0, 0.3, W, 14, DIM))
  if (s.phase === 'landed' && s.lastLanding) {
    out.push(label('ok1', 'THE EAGLE HAS LANDED', 0, 6, W, 26, GREEN))
    out.push(label('ok2', `x${s.lastLanding.mult} PAD   +${s.lastLanding.points}`, 0, 8, W, 20, WHITE))
  }
  return <UiEntity uiTransform={{ width: px(W * U), height: px(H * U) }}>{out}</UiEntity>
}

function Overlay() {
  const s = drift()
  const hi = driftHiScore()
  const blink = Math.floor(Date.now() / 500) % 2 === 0
  // Dimmed behind the title and game-over text, so it reads over the field; clear for quick in-game messages.
  const layer = (children: any[], dim = true) => (
    <UiEntity uiTransform={{ positionType: 'absolute', position: { left: 0, top: 0 }, width: px(W * U), height: px(H * U) }} uiBackground={dim ? { color: Color4.create(0.01, 0.0, 0.04, 0.78) } : undefined}>{children}</UiEntity>
  )
  if (s.phase === 'title') {
    return layer([
      label('t1', 'STAR DRIFT', 0, 2.5, W, 46, FRAME),
      label('t2', 'Set her down gently', 0, 5.2, W, 17, DIM),
      label('t3', 'UP or E: main engine      LEFT / RIGHT: thrusters', 0, 7.2, W, 15, WHITE),
      label('t4', 'Land slowly and level, feet on a pad', 0, 8.6, W, 15, WHITE),
      label('t5', 'Narrow pads pay more:  x2   x3   x5', 0, 10, W, 15, CYAN),
      blink ? label('t6', 'PRESS  E  OR  SPACE  TO  START', 0, 12, W, 22, CYAN) : null,
      hi.score > 0 ? label('t7', `STATION HIGH SCORE  ${hi.score}  ${hi.name}`, 0, 13.6, W, 16, AMBER) : null
    ].filter(Boolean))
  }
  if (s.phase === 'over') {
    const best = s.score > 0 && s.score >= hi.score
    return layer([
      label('o1', 'GAME OVER', 0, 4, W, 46, PINK),
      label('o2', `SCORE  ${s.score}     LEVEL  ${s.level}`, 0, 7, W, 24, WHITE),
      best ? label('o3', 'NEW STATION HIGH SCORE!', 0, 9, W, 22, AMBER) : null,
      blink ? label('o4', 'E / SPACE  PLAY AGAIN     F  LEAVE', 0, 11.5, W, 20, CYAN) : null
    ].filter(Boolean))
  }
  return null
}

function Gauges() {
  const s = drift()
  const hi = driftHiScore()
  // Speeds shown green when safe to land, amber when close, pink when too fast.
  const vyColour = s.vy <= 2.3 ? GREEN : s.vy <= 3 ? AMBER : PINK
  const vxColour = Math.abs(s.vx) <= 1.3 ? GREEN : Math.abs(s.vx) <= 1.8 ? AMBER : PINK
  const cell = (key: string, name: string, value: string, color: Color4) => (
    <UiEntity key={key} uiTransform={{ flexDirection: 'column', alignItems: 'center', width: px((W * U) / 6) }}>
      <Label value={name} fontSize={px(12)} color={DIM} />
      <Label value={value} fontSize={px(19)} color={color} />
    </UiEntity>
  )
  return (
    <UiEntity uiTransform={{ flexDirection: 'column', width: px(W * U), margin: { bottom: px(6) } }}>
      <UiEntity uiTransform={{ flexDirection: 'row', width: px(W * U), height: px(52) }}>
        {cell('score', 'SCORE', `${s.score}`, WHITE)}
        {cell('hi', 'STATION HI', hi.score > 0 ? `${hi.score}` : '-', AMBER)}
        {cell('level', 'LEVEL', `${s.level}`, CYAN)}
        {cell('ships', 'SHIPS', `${Math.max(0, s.lives)}`, PINK)}
        {cell('vy', 'DESCENT', `${s.vy.toFixed(1)}`, s.phase === 'flying' ? vyColour : DIM)}
        {cell('vx', 'DRIFT', `${Math.abs(s.vx).toFixed(1)}`, s.phase === 'flying' ? vxColour : DIM)}
      </UiEntity>
      <UiEntity uiTransform={{ width: px(W * U), height: px(8), margin: { top: px(4) } }} uiBackground={{ color: Color4.create(1, 1, 1, 0.1) }}>
        <UiEntity uiTransform={{ width: `${Math.round(s.fuel)}%`, height: '100%' }} uiBackground={{ color: s.fuel < 20 ? PINK : AMBER }} />
      </UiEntity>
    </UiEntity>
  )
}

export function DriftScreen() {
  if (!isPlayingDrift()) return null
  const best = driftBest()
  return (
    <UiEntity uiTransform={{ positionType: 'absolute', width: '100%', height: '100%', justifyContent: 'center', alignItems: 'center' }}>
      <UiEntity
        uiTransform={{ flexDirection: 'column', alignItems: 'center', padding: px(16), borderWidth: px(3), borderColor: FRAME }}
        uiBackground={{ color: BG }}
      >
        <Gauges />
        <UiEntity uiTransform={{ width: px(W * U), height: px(H * U), overflow: 'hidden' }}>
          <Field />
          <Overlay />
        </UiEntity>
        <UiEntity uiTransform={{ flexDirection: 'row', width: px(W * U), height: px(40), margin: { top: px(8) }, justifyContent: 'space-between', alignItems: 'center' }}>
          <Label value={`UP / E  ENGINE    LEFT / RIGHT  THRUSTERS    FUEL BAR ABOVE${best > 0 ? `    BEST ${best}` : ''}`} fontSize={px(13)} color={DIM} textAlign="middle-left" />
          <UiEntity
            uiTransform={{ padding: { left: px(12), right: px(12) }, height: px(32), alignItems: 'center' }}
            uiBackground={{ color: Color4.create(1, 1, 1, 0.08) }}
            onMouseDown={() => quitDrift()}
          >
            <Label value="F  LEAVE" fontSize={px(14)} color={CYAN} />
          </UiEntity>
        </UiEntity>
      </UiEntity>
    </UiEntity>
  )
}
