// NEBULA BREAKER's screen, drawn in the HUD while the player is at the cabinet: the field (every sprite a few solid
// boxes), a score bar on top, the controls underneath.
import ReactEcs, { UiEntity, Label } from '@dcl/sdk/react-ecs'
import { Color4 } from '@dcl/sdk/math'
import { px } from '../../uiScale'
import { W, H, PADDLE_Y, PADDLE_H, BALL_R, BRICK_W, BRICK_H, Power } from './game'
import { breaker, isPlayingBreaker, breakerHiScore, breakerBest, quitBreaker } from './play'

const U = 24 // pixels per field unit (at 1080p)
const BG = Color4.create(0.02, 0.0, 0.05, 0.96)
const FRAME = Color4.create(0.55, 0.4, 1, 1)
const CYAN = Color4.create(0.2, 0.9, 1, 1)
const PINK = Color4.create(1, 0.22, 0.7, 1)
const AMBER = Color4.create(1, 0.7, 0.15, 1)
const DIM = Color4.create(0.6, 0.6, 0.8, 1)
const WHITE = Color4.White()
const STEEL = Color4.create(0.4, 0.4, 0.46, 1)
const STEEL_DARK = Color4.create(0.26, 0.26, 0.3, 1)
// Nebula colours by row, top first.
const ROWS = [
  Color4.create(1, 0.3, 0.7, 1),
  Color4.create(0.85, 0.35, 1, 1),
  Color4.create(0.55, 0.4, 1, 1),
  Color4.create(0.3, 0.55, 1, 1),
  Color4.create(0.2, 0.85, 1, 1),
  Color4.create(0.3, 1, 0.75, 1)
]
const POWER_COLOURS: Record<Power['kind'], Color4> = { wide: CYAN, multi: PINK, slow: AMBER }
const POWER_LETTERS: Record<Power['kind'], string> = { wide: 'W', multi: 'M', slow: 'S' }

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

const dim = (c: Color4, k: number) => Color4.create(c.r * k, c.g * k, c.b * k, c.a)

function Field() {
  const s = breaker()
  const out: ReturnType<typeof box>[] = []
  // Faint stars, fixed.
  for (let i = 0; i < 40; i++) out.push(box(`st${i}`, (i * 7.7) % W, (i * 5.3) % H, 0.08, 0.08, Color4.create(1, 1, 1, 0.25)))
  if (s.phase === 'title') return <UiEntity uiTransform={{ width: px(W * U), height: px(H * U) }}>{out}</UiEntity>

  s.bricks.forEach((b, i) => {
    if (b.steel) {
      out.push(box(`b${i}`, b.x, b.y, BRICK_W, BRICK_H, STEEL))
      out.push(box(`b${i}d`, b.x + 0.3, b.y + 0.25, 0.5, 0.25, STEEL_DARK))
      out.push(box(`b${i}e`, b.x + 1.3, b.y + 0.4, 0.4, 0.2, STEEL_DARK))
      return
    }
    const c = ROWS[b.row % ROWS.length]
    // A cloud: a soft outer puff and a brighter core; two-hit clouds show a darker core until hit.
    out.push(box(`b${i}`, b.x, b.y + 0.1, BRICK_W, BRICK_H - 0.2, dim(c, 0.75)))
    out.push(box(`b${i}p`, b.x + 0.25, b.y, BRICK_W - 0.5, BRICK_H, dim(c, 0.75)))
    out.push(box(`b${i}c`, b.x + 0.4, b.y + 0.2, BRICK_W - 0.8, BRICK_H - 0.4, b.hp > 1 ? dim(c, 0.45) : c))
  })
  s.popped.forEach((p, i) => {
    const r = 1.1 - p.t * 2.5
    const c = ROWS[p.row % ROWS.length]
    out.push(box(`p${i}h`, p.x - r, p.y - 0.06, r * 2, 0.12, c))
    out.push(box(`p${i}v`, p.x - 0.06, p.y - r * 0.6, 0.12, r * 1.2, c))
  })
  s.powers.forEach((p, i) => {
    out.push(box(`w${i}`, p.x - 0.55, p.y - 0.3, 1.1, 0.6, POWER_COLOURS[p.kind]))
    out.push(label(`wl${i}`, POWER_LETTERS[p.kind], p.x - 0.55, p.y - 0.42, 1.1, 14, Color4.create(0.02, 0.02, 0.06, 1)))
  })
  // The paddle: a bar with glowing ends; cyan while wide.
  const pw = s.paddleW
  const pc = s.wide > 0 ? CYAN : WHITE
  out.push(box('pad', s.paddleX - pw / 2, PADDLE_Y, pw, PADDLE_H, pc))
  out.push(box('padL', s.paddleX - pw / 2, PADDLE_Y - 0.08, 0.35, PADDLE_H + 0.16, PINK))
  out.push(box('padR', s.paddleX + pw / 2 - 0.35, PADDLE_Y - 0.08, 0.35, PADDLE_H + 0.16, PINK))
  // Comets: a bright head and a short fading tail behind it.
  s.balls.forEach((b, i) => {
    const v = Math.hypot(b.vx, b.vy) || 1
    const tx = -b.vx / v
    const ty = -b.vy / v
    for (let k = 3; k >= 1; k--) {
      const r = BALL_R * (1 - k * 0.2)
      out.push(box(`t${i}${k}`, b.x + tx * k * 0.35 - r, b.y + ty * k * 0.35 - r, 2 * r, 2 * r, Color4.create(1, 0.75, 0.3, 0.5 - k * 0.12)))
    }
    out.push(box(`c${i}`, b.x - BALL_R, b.y - BALL_R, 2 * BALL_R, 2 * BALL_R, s.slow > 0 ? AMBER : WHITE))
  })
  return <UiEntity uiTransform={{ width: px(W * U), height: px(H * U) }}>{out}</UiEntity>
}

function Overlay() {
  const s = breaker()
  const hi = breakerHiScore()
  const blink = Math.floor(Date.now() / 500) % 2 === 0
  const layer = (children: any[]) => (
    <UiEntity uiTransform={{ positionType: 'absolute', position: { left: 0, top: 0 }, width: px(W * U), height: px(H * U) }}>{children}</UiEntity>
  )
  if (s.phase === 'title') {
    return layer([
      label('t1', 'NEBULA BREAKER', 0, 3, W, 42, FRAME),
      label('t2', 'Bounce a comet through the nebula', 0, 5.6, W, 17, DIM),
      box('d1', 5, 8.5, BRICK_W, BRICK_H, ROWS[0]),
      label('t3', 'nebula cloud: bust it', 7.6, 8.4, 10, 17, WHITE),
      box('d2', 5, 10.5, BRICK_W, BRICK_H, STEEL),
      label('t4', 'asteroid: won\'t break', 7.6, 10.4, 10, 17, WHITE),
      box('d3', 5.5, 12.5, 1.1, 0.6, CYAN), label('d3l', 'W', 5.5, 12.4, 1.1, 14, Color4.Black()),
      box('d4', 7.2, 12.5, 1.1, 0.6, PINK), label('d4l', 'M', 7.2, 12.4, 1.1, 14, Color4.Black()),
      box('d5', 8.9, 12.5, 1.1, 0.6, AMBER), label('d5l', 'S', 8.9, 12.4, 1.1, 14, Color4.Black()),
      label('t5', 'wide · multi · slow', 10.2, 12.4, 7, 16, WHITE),
      label('t6', 'Where it hits your paddle sets its angle', 0, 14.5, W, 15, DIM),
      blink ? label('t7', 'PRESS  E  OR  SPACE  TO  START', 0, 18, W, 22, CYAN) : null,
      hi.score > 0 ? label('t8', `STATION HIGH SCORE  ${hi.score}  ${hi.name}`, 0, 20.3, W, 16, AMBER) : null
    ].filter(Boolean))
  }
  if (s.phase === 'over') {
    const best = s.score > 0 && s.score >= hi.score
    return layer([
      label('o1', 'GAME OVER', 0, 8, W, 46, PINK),
      label('o2', `SCORE  ${s.score}     LEVEL  ${s.level}`, 0, 11, W, 24, WHITE),
      best ? label('o3', 'NEW STATION HIGH SCORE!', 0, 13, W, 22, AMBER) : null,
      blink ? label('o4', 'E / SPACE  PLAY AGAIN     F  LEAVE', 0, 17, W, 20, CYAN) : null
    ].filter(Boolean))
  }
  if (s.phase === 'cleared') return layer([label('c1', `LEVEL ${s.level} CLEARED`, 0, 11, W, 32, CYAN)])
  if (s.balls.length === 1 && s.balls[0].stuck && s.phase === 'playing') return layer([label('l1', 'E / SPACE  TO  LAUNCH', 0, 17.5, W, 18, DIM)])
  return null
}

function ScoreBar() {
  const s = breaker()
  const hi = breakerHiScore()
  const cell = (key: string, name: string, value: string, color: Color4) => (
    <UiEntity key={key} uiTransform={{ flexDirection: 'column', alignItems: 'center', width: px((W * U) / 4) }}>
      <Label value={name} fontSize={px(13)} color={DIM} />
      <Label value={value} fontSize={px(22)} color={color} />
    </UiEntity>
  )
  return (
    <UiEntity uiTransform={{ flexDirection: 'row', width: px(W * U), height: px(56), margin: { bottom: px(6) } }}>
      {cell('score', 'SCORE', `${s.score}`, WHITE)}
      {cell('hi', 'STATION HI', hi.score > 0 ? `${hi.score}` : '-', AMBER)}
      {cell('level', 'LEVEL', `${s.level}`, CYAN)}
      {cell('lives', 'COMETS', `${Math.max(0, s.lives)}`, PINK)}
    </UiEntity>
  )
}

export function BreakerScreen() {
  if (!isPlayingBreaker()) return null
  const best = breakerBest()
  return (
    <UiEntity uiTransform={{ positionType: 'absolute', width: '100%', height: '100%', justifyContent: 'center', alignItems: 'center' }}>
      <UiEntity
        uiTransform={{ flexDirection: 'column', alignItems: 'center', padding: px(16), borderWidth: px(3), borderColor: FRAME }}
        uiBackground={{ color: BG }}
      >
        <ScoreBar />
        <UiEntity uiTransform={{ width: px(W * U), height: px(H * U) }}>
          <Field />
          <Overlay />
        </UiEntity>
        <UiEntity uiTransform={{ flexDirection: 'row', width: px(W * U), height: px(40), margin: { top: px(8) }, justifyContent: 'space-between', alignItems: 'center' }}>
          <Label value={`A / D  (or 1 / 2)  MOVE    E / SPACE  LAUNCH${best > 0 ? `    BEST ${best}` : ''}`} fontSize={px(14)} color={DIM} textAlign="middle-left" />
          <UiEntity
            uiTransform={{ padding: { left: px(12), right: px(12) }, height: px(32), alignItems: 'center' }}
            uiBackground={{ color: Color4.create(1, 1, 1, 0.08) }}
            onMouseDown={() => quitBreaker()}
          >
            <Label value="F  LEAVE" fontSize={px(14)} color={CYAN} />
          </UiEntity>
        </UiEntity>
      </UiEntity>
    </UiEntity>
  )
}

