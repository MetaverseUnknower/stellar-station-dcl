// ORBIT BLASTER's screen, drawn in the HUD while the player is at the cabinet: the planet and its shield, the orbit,
// the ship on it and the raiders closing in (every sprite a few solid boxes, placed by polar maths).
import ReactEcs, { UiEntity, Label } from '@dcl/sdk/react-ecs'
import { Color4 } from '@dcl/sdk/math'
import { px } from '../../uiScale'
import { S, PLANET_R, ORBIT_R, SIZE, START_SHIELD, xy, Kind } from './game'
import { orbit, isPlayingOrbit, orbitHiScore, orbitBest, quitOrbit } from './play'

const U = 24 // pixels per field unit (at 1080p)
const BG = Color4.create(0.01, 0.01, 0.04, 0.96)
const FRAME = Color4.create(0.3, 0.8, 1, 1)
const CYAN = Color4.create(0.2, 0.9, 1, 1)
const PINK = Color4.create(1, 0.22, 0.7, 1)
const AMBER = Color4.create(1, 0.7, 0.15, 1)
const DIM = Color4.create(0.6, 0.6, 0.8, 1)
const WHITE = Color4.White()
const COLOURS: Record<Kind, Color4> = {
  drifter: Color4.create(1, 0.35, 0.3, 1),
  weaver: Color4.create(0.4, 1, 0.45, 1),
  splitter: Color4.create(0.75, 0.45, 1, 1),
  shard: Color4.create(0.85, 0.6, 1, 1)
}

function box(key: string, x: number, y: number, w: number, h: number, color: Color4) {
  return (
    <UiEntity
      key={key}
      uiTransform={{ positionType: 'absolute', position: { left: px(x * U), top: px(y * U) }, width: px(w * U), height: px(h * U) }}
      uiBackground={{ color }}
    />
  )
}
const at = (key: string, x: number, y: number, size: number, color: Color4) => box(key, x - size / 2, y - size / 2, size, size, color)

function label(key: string, value: string, y: number, size: number, color: Color4) {
  return (
    <UiEntity key={key} uiTransform={{ positionType: 'absolute', position: { left: 0, top: px(y * U) }, width: px(S * U), height: px(size * 1.4) }}>
      <Label value={value} fontSize={px(size)} color={color} textAlign="middle-center" uiTransform={{ width: '100%', height: '100%' }} />
    </UiEntity>
  )
}

/** A raider: a diamond (two crossed bars and a core) in its colour; splitters with a darker middle while whole. */
function raider(key: string, r: number, a: number, kind: Kind, hp: number) {
  const { x, y } = xy(r, a)
  const s = SIZE[kind] * 2
  const c = COLOURS[kind]
  return [
    box(`${key}h`, x - s / 2, y - s * 0.18, s, s * 0.36, c),
    box(`${key}v`, x - s * 0.18, y - s / 2, s * 0.36, s, c),
    at(`${key}c`, x, y, s * 0.5, kind === 'splitter' && hp > 1 ? Color4.create(0.35, 0.2, 0.55, 1) : WHITE)
  ]
}

function Field() {
  const s = orbit()
  const out: ReturnType<typeof box>[] = []
  for (let i = 0; i < 50; i++) out.push(box(`st${i}`, (i * 7.3) % S, (i * 4.3) % S, 0.07, 0.07, Color4.create(1, 1, 1, 0.2 + (i % 3) * 0.15)))
  const c = S / 2
  // The planet: stacked boxes for a round-ish disc, a lit side, and a band.
  const p = PLANET_R
  out.push(box('pa', c - p, c - p * 0.55, 2 * p, p * 1.1, Color4.create(0.2, 0.45, 0.85, 1)))
  out.push(box('pb', c - p * 0.55, c - p, p * 1.1, 2 * p, Color4.create(0.2, 0.45, 0.85, 1)))
  out.push(box('pc', c - p * 0.82, c - p * 0.82, p * 1.64, p * 1.64, Color4.create(0.2, 0.45, 0.85, 1)))
  out.push(box('pl', c - p * 0.7, c - p * 0.7, p * 0.8, p * 0.6, Color4.create(0.4, 0.7, 1, 1)))
  out.push(box('pbnd', c - p * 0.95, c + p * 0.15, p * 1.9, p * 0.22, Color4.create(0.3, 0.85, 0.6, 1)))
  // Its shield: a ring of dots, one lit per point of shield left; flashing when struck.
  const flash = s.shieldFlash > 0 && Math.floor(s.shieldFlash * 20) % 2 === 0
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2
    const q = xy(PLANET_R + 0.7, a)
    const lit = (i / 24) * START_SHIELD < s.shield
    out.push(at(`sh${i}`, q.x, q.y, 0.2, flash ? PINK : lit ? Color4.create(0.4, 0.9, 1, 0.9) : Color4.create(0.4, 0.9, 1, 0.15)))
  }
  // The orbit, dotted.
  for (let i = 0; i < 60; i++) {
    const q = xy(ORBIT_R, (i / 60) * Math.PI * 2)
    out.push(at(`o${i}`, q.x, q.y, 0.1, Color4.create(0.5, 0.6, 1, 0.35)))
  }
  if (s.phase === 'title') return <UiEntity uiTransform={{ width: px(S * U), height: px(S * U) }}>{out}</UiEntity>

  s.pods.forEach((pd, i) => {
    const q = xy(pd.r, pd.a)
    out.push(at(`pd${i}`, q.x, q.y, 0.75, AMBER))
    out.push(at(`pdi${i}`, q.x, q.y, 0.35, BG))
  })
  s.raiders.forEach((rd, i) => out.push(...raider(`r${i}`, rd.r, rd.a, rd.kind, rd.hp)))
  s.shots.forEach((sh, i) => {
    const q = xy(sh.r, sh.a)
    out.push(at(`s${i}`, q.x, q.y, 0.22, s.rapid > 0 ? AMBER : CYAN))
  })
  s.booms.forEach((b, i) => {
    const q = xy(b.r, b.a)
    const r = 1 - b.t * 2.5
    out.push(box(`b${i}h`, q.x - r, q.y - 0.06, 2 * r, 0.12, COLOURS[b.kind]))
    out.push(box(`b${i}v`, q.x - 0.06, q.y - r, 0.12, 2 * r, COLOURS[b.kind]))
  })
  // The ship: a body on the orbit and a nose pointing out (the way it fires); flickering if just hit.
  const flicker = s.invulnerable > 0 && Math.floor(s.invulnerable * 12) % 2 === 0
  if (s.phase !== 'over' && !flicker) {
    const body = xy(ORBIT_R, s.angle)
    const nose = xy(ORBIT_R + 0.55, s.angle)
    const tail = xy(ORBIT_R - 0.35, s.angle)
    out.push(at('shipt', tail.x, tail.y, 0.45, PINK))
    out.push(at('shipb', body.x, body.y, 0.75, WHITE))
    out.push(at('shipn', nose.x, nose.y, 0.35, s.rapid > 0 ? AMBER : CYAN))
  }
  return <UiEntity uiTransform={{ width: px(S * U), height: px(S * U) }}>{out}</UiEntity>
}

function Overlay() {
  const s = orbit()
  const hi = orbitHiScore()
  const blink = Math.floor(Date.now() / 500) % 2 === 0
  // Dimmed behind the title and game-over text, so it reads over the field; clear for quick in-game messages.
  const layer = (children: any[], dim = true) => (
    <UiEntity uiTransform={{ positionType: 'absolute', position: { left: 0, top: 0 }, width: px(S * U), height: px(S * U) }} uiBackground={dim ? { color: Color4.create(0.01, 0.0, 0.04, 0.78) } : undefined}>{children}</UiEntity>
  )
  if (s.phase === 'title') {
    return layer([
      label('t1', 'ORBIT BLASTER', 1.6, 42, FRAME),
      label('t2', 'Hold the orbit. Save the planet.', 4, 17, DIM),
      label('t3', 'Your shots fly OUT: stop raiders before they cross your orbit', 14.6, 14, WHITE),
      label('t4', 'red drifts in  ·  green weaves  ·  violet splits in two', 15.8, 14, WHITE),
      label('t5', 'catch amber pods for rapid fire', 17, 14, AMBER),
      blink ? label('t6', 'PRESS  E  OR  SPACE  TO  START', 18.8, 21, CYAN) : null,
      hi.score > 0 ? label('t7', `STATION HIGH SCORE  ${hi.score}  ${hi.name}`, 20.3, 15, AMBER) : null
    ].filter(Boolean))
  }
  if (s.phase === 'over') {
    const best = s.score > 0 && s.score >= hi.score
    return layer([
      label('o1', s.shield <= 0 ? 'THE PLANET FELL' : 'GAME OVER', 3, 40, PINK),
      label('o2', `SCORE  ${s.score}     WAVE  ${s.wave}`, 15.2, 22, WHITE),
      best ? label('o3', 'NEW STATION HIGH SCORE!', 17, 20, AMBER) : null,
      blink ? label('o4', 'E / SPACE  PLAY AGAIN     F  LEAVE', 19, 18, CYAN) : null
    ].filter(Boolean))
  }
  if (s.phase === 'between') return layer([label('w1', `WAVE ${s.wave} HELD`, 3.5, 30, CYAN)], false)
  return null
}

function ScoreBar() {
  const s = orbit()
  const hi = orbitHiScore()
  const cell = (key: string, name: string, value: string, color: Color4) => (
    <UiEntity key={key} uiTransform={{ flexDirection: 'column', alignItems: 'center', width: px((S * U) / 5) }}>
      <Label value={name} fontSize={px(12)} color={DIM} />
      <Label value={value} fontSize={px(20)} color={color} />
    </UiEntity>
  )
  return (
    <UiEntity uiTransform={{ flexDirection: 'row', width: px(S * U), height: px(52), margin: { bottom: px(6) } }}>
      {cell('score', 'SCORE', `${s.score}`, WHITE)}
      {cell('hi', 'STATION HI', hi.score > 0 ? `${hi.score}` : '-', AMBER)}
      {cell('wave', 'WAVE', `${s.wave}`, CYAN)}
      {cell('ships', 'SHIPS', `${Math.max(0, s.lives)}`, PINK)}
      {cell('shield', 'SHIELD', `${Math.max(0, s.shield)}/${START_SHIELD}`, Color4.create(0.4, 0.9, 1, 1))}
    </UiEntity>
  )
}

export function OrbitScreen() {
  if (!isPlayingOrbit()) return null
  const best = orbitBest()
  return (
    <UiEntity uiTransform={{ positionType: 'absolute', width: '100%', height: '100%', justifyContent: 'center', alignItems: 'center' }}>
      <UiEntity
        uiTransform={{ flexDirection: 'column', alignItems: 'center', padding: px(16), borderWidth: px(3), borderColor: FRAME }}
        uiBackground={{ color: BG }}
      >
        <ScoreBar />
        <UiEntity uiTransform={{ width: px(S * U), height: px(S * U), overflow: 'hidden' }}>
          <Field />
          <Overlay />
        </UiEntity>
        <UiEntity uiTransform={{ flexDirection: 'row', width: px(S * U), height: px(40), margin: { top: px(8) }, justifyContent: 'space-between', alignItems: 'center' }}>
          <Label value={`A / D  (or 1 / 2)  ORBIT    E / SPACE  FIRE${best > 0 ? `    BEST ${best}` : ''}`} fontSize={px(14)} color={DIM} textAlign="middle-left" />
          <UiEntity
            uiTransform={{ padding: { left: px(12), right: px(12) }, height: px(32), alignItems: 'center' }}
            uiBackground={{ color: Color4.create(1, 1, 1, 0.08) }}
            onMouseDown={() => quitOrbit()}
          >
            <Label value="F  LEAVE" fontSize={px(14)} color={CYAN} />
          </UiEntity>
        </UiEntity>
      </UiEntity>
    </UiEntity>
  )
}
