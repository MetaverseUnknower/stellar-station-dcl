// COMET RUN's screen, drawn in the HUD while the player is at the cabinet: the asteroid field streaming down (every
// sprite a few solid boxes), a score bar on top with the boost meter, the controls underneath.
import ReactEcs, { UiEntity, Label } from '@dcl/sdk/react-ecs'
import { Color4 } from '@dcl/sdk/math'
import { px } from '../../uiScale'
import { W, H, COMET_R, DUST_R } from './game'
import { comet, isPlayingComet, cometHiScore, cometBest, quitComet } from './play'

const U = 24 // pixels per field unit (at 1080p)
const BG = Color4.create(0.01, 0.01, 0.04, 0.96)
const FRAME = Color4.create(1, 0.6, 0.2, 1)
const CYAN = Color4.create(0.2, 0.9, 1, 1)
const PINK = Color4.create(1, 0.22, 0.7, 1)
const AMBER = Color4.create(1, 0.7, 0.15, 1)
const DIM = Color4.create(0.6, 0.6, 0.8, 1)
const WHITE = Color4.White()
const ROCK = Color4.create(0.5, 0.44, 0.42, 1)
const ROCK_LIGHT = Color4.create(0.66, 0.6, 0.56, 1)
const ROCK_DARK = Color4.create(0.3, 0.26, 0.26, 1)
const DUST = Color4.create(1, 0.95, 0.55, 1)

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

/** A blocky round asteroid: a cross of boxes and a rim, lit from the top left, a crater or two. */
function rock(key: string, x: number, y: number, r: number, spin: number) {
  const out = [
    box(`${key}a`, x - r, y - r * 0.6, 2 * r, r * 1.2, ROCK),
    box(`${key}b`, x - r * 0.6, y - r, r * 1.2, 2 * r, ROCK),
    box(`${key}c`, x - r * 0.8, y - r * 0.8, r * 1.6, r * 1.6, ROCK),
    box(`${key}l`, x - r * 0.7, y - r * 0.75, r * 0.7, r * 0.35, ROCK_LIGHT)
  ]
  const cx = Math.cos(spin) * r * 0.35
  const cy = Math.sin(spin) * r * 0.35
  out.push(box(`${key}k`, x + cx - r * 0.2, y + cy - r * 0.2, r * 0.4, r * 0.4, ROCK_DARK))
  return out
}

function Field() {
  const s = comet()
  const out: ReturnType<typeof box>[] = []
  // Stars streaming past, faster the faster you go (three layers for depth).
  const speed = s.phase === 'playing' ? s.scroll * (s.boosting ? 1.6 : 1) : 4
  const t = Date.now() / 1000
  for (let layer = 0; layer < 3; layer++) {
    const v = speed * (0.25 + layer * 0.3)
    for (let i = 0; i < 14; i++) {
      const x = (i * 7.31 + layer * 3.1) % W
      const y = (((i * 5.17 + layer * 11) % H) + t * v) % H
      const len = 0.1 + v * 0.02
      out.push(box(`s${layer}${i}`, x, y, 0.08, len, Color4.create(1, 1, 1, 0.2 + layer * 0.2)))
    }
  }
  if (s.phase === 'title') return <UiEntity uiTransform={{ width: px(W * U), height: px(H * U) }}>{out}</UiEntity>

  s.dust.forEach((d, i) => {
    out.push(box(`d${i}`, d.x - DUST_R, d.y - DUST_R, 2 * DUST_R, 2 * DUST_R, DUST))
    out.push(box(`d${i}g`, d.x - DUST_R * 2, d.y - 0.03, DUST_R * 4, 0.06, Color4.create(1, 0.95, 0.55, 0.5)))
  })
  if (s.shieldPickup) {
    const p = s.shieldPickup
    out.push(box('sp', p.x - 0.45, p.y - 0.45, 0.9, 0.9, CYAN))
    out.push(box('spi', p.x - 0.28, p.y - 0.28, 0.56, 0.56, BG))
    out.push(box('spc', p.x - 0.12, p.y - 0.12, 0.24, 0.24, CYAN))
  }
  s.rocks.forEach((r, i) => out.push(...rock(`r${i}`, r.x, r.y, r.r, r.spin)))

  // The comet: a white-hot head, an amber tail streaming behind (down), longer while boosting; flickering if hit.
  const flicker = s.invulnerable > 0 && Math.floor(s.invulnerable * 12) % 2 === 0
  if (s.phase !== 'over' && !flicker) {
    const tail = s.boosting ? 6 : 4
    for (let k = tail; k >= 1; k--) {
      const w = COMET_R * 2 * (1 - k / (tail + 1))
      out.push(box(`t${k}`, s.x - w / 2, s.y + k * 0.42, w, 0.5, Color4.create(1, 0.55 + 0.05 * k, 0.15, 0.85 - k * 0.12)))
    }
    if (s.shield) out.push(box('sh', s.x - COMET_R - 0.3, s.y - COMET_R - 0.3, 2 * COMET_R + 0.6, 2 * COMET_R + 0.6, Color4.create(0.2, 0.9, 1, 0.35)))
    out.push(box('head', s.x - COMET_R, s.y - COMET_R, 2 * COMET_R, 2 * COMET_R, WHITE))
    out.push(box('core', s.x - COMET_R * 0.5, s.y - COMET_R * 0.5, COMET_R, COMET_R, Color4.create(1, 0.95, 0.75, 1)))
  }
  s.popups.forEach((p, i) => out.push(label(`p${i}`, p.text, p.x - 2, p.y - 0.6 - (0.8 - p.t), 4, 16, AMBER)))
  return <UiEntity uiTransform={{ width: px(W * U), height: px(H * U) }}>{out}</UiEntity>
}

function Overlay() {
  const s = comet()
  const hi = cometHiScore()
  const blink = Math.floor(Date.now() / 500) % 2 === 0
  // Dimmed behind the title and game-over text, so it reads over the field; clear for quick in-game messages.
  const layer = (children: any[], dim = true) => (
    <UiEntity uiTransform={{ positionType: 'absolute', position: { left: 0, top: 0 }, width: px(W * U), height: px(H * U) }} uiBackground={dim ? { color: Color4.create(0.01, 0.0, 0.04, 0.78) } : undefined}>{children}</UiEntity>
  )
  if (s.phase === 'title') {
    return layer([
      label('t1', 'COMET RUN', 0, 3, W, 46, FRAME),
      label('t2', 'Streak through the asteroid field', 0, 5.8, W, 17, DIM),
      ...rock('tr', 6.3, 9.2, 0.7, 0.6),
      label('t3', 'asteroid: dodge it', 7.6, 8.6, 9, 17, WHITE),
      box('td', 6.1, 11, 0.36, 0.36, DUST),
      label('t4', 'stardust: +10', 7.6, 10.6, 9, 17, WHITE),
      box('ts', 5.85, 12.55, 0.9, 0.9, CYAN), box('tsi', 6.02, 12.72, 0.56, 0.56, BG),
      label('t5', 'shield: one free hit', 7.6, 12.6, 9, 17, WHITE),
      label('t6', 'Skim close past a rock for a NEAR MISS bonus', 0, 14.8, W, 15, DIM),
      label('t7', 'Hold boost to go faster for double points', 0, 16, W, 15, DIM),
      blink ? label('t8', 'PRESS  E  OR  SPACE  TO  START', 0, 18.6, W, 22, CYAN) : null,
      hi.score > 0 ? label('t9', `STATION HIGH SCORE  ${hi.score}  ${hi.name}`, 0, 20.8, W, 16, AMBER) : null
    ].filter(Boolean))
  }
  if (s.phase === 'over') {
    const score = Math.floor(s.score)
    const best = score > 0 && score >= hi.score
    return layer([
      label('o1', 'GAME OVER', 0, 7.5, W, 46, PINK),
      label('o2', `SCORE  ${score}`, 0, 10.5, W, 26, WHITE),
      label('o3', `DISTANCE  ${Math.floor(s.distance)} m`, 0, 12, W, 18, DIM),
      best ? label('o4', 'NEW STATION HIGH SCORE!', 0, 13.8, W, 22, AMBER) : null,
      blink ? label('o5', 'E / SPACE  PLAY AGAIN     F  LEAVE', 0, 17, W, 20, CYAN) : null
    ].filter(Boolean))
  }
  return null
}

function ScoreBar() {
  const s = comet()
  const hi = cometHiScore()
  const cell = (key: string, name: string, value: string, color: Color4) => (
    <UiEntity key={key} uiTransform={{ flexDirection: 'column', alignItems: 'center', width: px((W * U) / 4) }}>
      <Label value={name} fontSize={px(13)} color={DIM} />
      <Label value={value} fontSize={px(22)} color={color} />
    </UiEntity>
  )
  return (
    <UiEntity uiTransform={{ flexDirection: 'column', width: px(W * U), margin: { bottom: px(6) } }}>
      <UiEntity uiTransform={{ flexDirection: 'row', width: px(W * U), height: px(56) }}>
        {cell('score', 'SCORE', `${Math.floor(s.score)}`, WHITE)}
        {cell('hi', 'STATION HI', hi.score > 0 ? `${hi.score}` : '-', AMBER)}
        {cell('dist', 'DISTANCE', `${Math.floor(s.distance)}`, CYAN)}
        {cell('lives', 'LIVES', `${Math.max(0, s.lives)}`, PINK)}
      </UiEntity>
      {/* The boost meter. */}
      <UiEntity uiTransform={{ width: px(W * U), height: px(8), margin: { top: px(4) } }} uiBackground={{ color: Color4.create(1, 1, 1, 0.1) }}>
        <UiEntity uiTransform={{ width: `${Math.round(s.boost * 100)}%`, height: '100%' }} uiBackground={{ color: s.boosting ? AMBER : FRAME }} />
      </UiEntity>
    </UiEntity>
  )
}

export function CometScreen() {
  if (!isPlayingComet()) return null
  const best = cometBest()
  return (
    <UiEntity uiTransform={{ positionType: 'absolute', width: '100%', height: '100%', justifyContent: 'center', alignItems: 'center' }}>
      <UiEntity
        uiTransform={{ flexDirection: 'column', alignItems: 'center', padding: px(16), borderWidth: px(3), borderColor: FRAME }}
        uiBackground={{ color: BG }}
      >
        <ScoreBar />
        <UiEntity uiTransform={{ width: px(W * U), height: px(H * U), overflow: 'hidden' }}>
          <Field />
          <Overlay />
        </UiEntity>
        <UiEntity uiTransform={{ flexDirection: 'row', width: px(W * U), height: px(40), margin: { top: px(8) }, justifyContent: 'space-between', alignItems: 'center' }}>
          <Label value={`ARROWS / WASD  STEER    HOLD E / SPACE  BOOST${best > 0 ? `    BEST ${best}` : ''}`} fontSize={px(14)} color={DIM} textAlign="middle-left" />
          <UiEntity
            uiTransform={{ padding: { left: px(12), right: px(12) }, height: px(32), alignItems: 'center' }}
            uiBackground={{ color: Color4.create(1, 1, 1, 0.08) }}
            onMouseDown={() => quitComet()}
          >
            <Label value="F  LEAVE" fontSize={px(14)} color={CYAN} />
          </UiEntity>
        </UiEntity>
      </UiEntity>
    </UiEntity>
  )
}
