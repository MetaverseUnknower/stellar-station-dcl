// VOID RACER's screen, drawn in the HUD while the player is at the cabinet: a pseudo-3D neon road into the void
// (game.ts view(): slices of road smaller and higher toward the horizon), the things on it, the car, and a dash with
// speed, time and score.
import ReactEcs, { UiEntity, Label } from '@dcl/sdk/react-ecs'
import { Color4 } from '@dcl/sdk/math'
import { px } from '../../uiScale'
import { view, Sprite } from './game'
import { racer, isPlayingRacer, racerHiScore, racerBest, quitRacer } from './play'

const FW = 640 // the screen, in pixels at 1080p
const FH = 420
const HORIZON = 0.36 // fraction down the screen
const BG = Color4.create(0.01, 0.0, 0.05, 0.97)
const FRAME = Color4.create(1, 0.25, 0.8, 1)
const CYAN = Color4.create(0.2, 0.9, 1, 1)
const PINK = Color4.create(1, 0.22, 0.7, 1)
const AMBER = Color4.create(1, 0.7, 0.15, 1)
const DIM = Color4.create(0.6, 0.6, 0.8, 1)
const WHITE = Color4.White()
const ROAD_A = Color4.create(0.12, 0.08, 0.22, 1)
const ROAD_B = Color4.create(0.15, 0.1, 0.26, 1)
const VOID_A = Color4.create(0.03, 0.01, 0.08, 1)
const VOID_B = Color4.create(0.05, 0.02, 0.11, 1)

function rect(key: string, x: number, y: number, w: number, h: number, color: Color4) {
  return (
    <UiEntity
      key={key}
      uiTransform={{ positionType: 'absolute', position: { left: px(x), top: px(y) }, width: px(Math.max(0, w)), height: px(Math.max(0, h)) }}
      uiBackground={{ color }}
    />
  )
}

function label(key: string, value: string, y: number, size: number, color: Color4) {
  return (
    <UiEntity key={key} uiTransform={{ positionType: 'absolute', position: { left: 0, top: px(y) }, width: px(FW), height: px(size * 1.4) }}>
      <Label value={value} fontSize={px(size)} color={color} textAlign="middle-center" uiTransform={{ width: '100%', height: '100%' }} />
    </UiEntity>
  )
}

/** A thing on the road, sized by its distance. */
function sprite(key: string, sp: Sprite, sx: number, sy: number) {
  const w = sp.size * FW
  const x = sx - w / 2
  if (sp.kind === 'orb') {
    return [rect(`${key}a`, x, sy - w, w, w, CYAN), rect(`${key}b`, x + w * 0.25, sy - w * 0.75, w * 0.5, w * 0.5, WHITE)]
  }
  if (sp.kind === 'debris') {
    return [rect(`${key}a`, x, sy - w * 0.55, w, w * 0.55, Color4.create(0.45, 0.4, 0.5, 1)), rect(`${key}b`, x + w * 0.2, sy - w * 0.75, w * 0.5, w * 0.25, Color4.create(0.6, 0.55, 0.65, 1))]
  }
  // A rival: a low car with glowing tail lights.
  return [
    rect(`${key}a`, x, sy - w * 0.42, w, w * 0.42, Color4.create(0.3, 0.9, 0.5, 1)),
    rect(`${key}b`, x + w * 0.2, sy - w * 0.62, w * 0.6, w * 0.22, Color4.create(0.2, 0.55, 0.35, 1)),
    rect(`${key}c`, x + w * 0.06, sy - w * 0.3, w * 0.18, w * 0.1, PINK),
    rect(`${key}d`, x + w * 0.76, sy - w * 0.3, w * 0.18, w * 0.1, PINK)
  ]
}

function Road() {
  const s = racer()
  const v = view(s)
  const out: ReturnType<typeof rect>[] = []
  // The void above: a gradient of bands, a purple sun on the horizon, the horizon shifting with the bend.
  for (let i = 0; i < 6; i++) out.push(rect(`sky${i}`, 0, (i * HORIZON * FH) / 6, FW, (HORIZON * FH) / 6 + 1, Color4.create(0.05 + i * 0.03, 0.01, 0.12 + i * 0.03, 1)))
  const sunX = FW / 2 - v.bend * 4000
  out.push(rect('sun', sunX - 60, HORIZON * FH - 70, 120, 70, Color4.create(1, 0.3, 0.6, 1)))
  for (let k = 0; k < 4; k++) out.push(rect(`sunb${k}`, sunX - 60, HORIZON * FH - 55 + k * 13, 120, 3 + k, Color4.create(0.05 + k * 0.03, 0.01, 0.12 + k * 0.03, 1)))
  out.push(rect('void', 0, HORIZON * FH, FW, (1 - HORIZON) * FH, VOID_A))
  // Road slices, far to near, each from its own y down to the next nearer one's.
  const yOf = (f: number) => HORIZON * FH + f * (1 - HORIZON) * FH
  for (let i = v.slices.length - 1; i >= 0; i--) {
    const sl = v.slices[i]
    const top = yOf(sl.y)
    const bottom = i > 0 ? yOf(v.slices[i - 1].y) : FH
    const h = bottom - top + 1
    if (h <= 0.3) continue
    const cx = FW / 2 + sl.cx * FW
    const half = sl.half * FW
    if (sl.stripe) out.push(rect(`v${i}`, 0, top, FW, h, VOID_B)) // the void's alternate bands (the rest is the base below)
    out.push(rect(`r${i}`, cx - half, top, half * 2, h, sl.stripe ? ROAD_A : ROAD_B))
    // Rumble strips and the centre line; a bright band across at the checkpoint.
    const rumble = Math.max(1, half * 0.08)
    out.push(rect(`ra${i}`, cx - half - rumble, top, rumble, h, sl.stripe ? PINK : CYAN))
    out.push(rect(`rb${i}`, cx + half, top, rumble, h, sl.stripe ? PINK : CYAN))
    if (sl.stripe && i < 45) out.push(rect(`c${i}`, cx - rumble * 0.3, top, rumble * 0.6, h, Color4.create(1, 1, 1, 0.5)))
    if (sl.checkpoint) out.push(rect(`cp${i}`, cx - half, top, half * 2, Math.max(2, h), AMBER))
  }
  // Things on the road, far to near.
  v.sprites.forEach((sp, i) => out.push(...sprite(`s${i}`, sp, FW / 2 + sp.x * FW, yOf(sp.y))))
  // The car: low and wide at the bottom, leaning into turns, shaking when hit.
  if (s.phase === 'racing' || s.phase === 'over') {
    const shake = s.bump > 0 ? Math.sin(Date.now() / 20) * 6 : 0
    const cx = FW / 2 + shake
    const cy = FH - 26
    out.push(rect('cb', cx - 58, cy - 26, 116, 26, Color4.create(0.15, 0.85, 1, 1)))
    out.push(rect('ct', cx - 36, cy - 44, 72, 20, Color4.create(0.08, 0.35, 0.55, 1)))
    out.push(rect('cw', cx - 30, cy - 40, 60, 12, Color4.create(0.6, 0.9, 1, 0.8)))
    out.push(rect('cl', cx - 54, cy - 18, 18, 7, PINK))
    out.push(rect('cr', cx + 36, cy - 18, 18, 7, PINK))
    out.push(rect('cg', cx - 50, cy, 100, 6, Color4.create(0.2, 0.9, 1, 0.5))) // the hover glow
  }
  return <UiEntity uiTransform={{ width: px(FW), height: px(FH) }}>{out}</UiEntity>
}

function Overlay() {
  const s = racer()
  const hi = racerHiScore()
  const blink = Math.floor(Date.now() / 500) % 2 === 0
  const layer = (children: any[]) => (
    <UiEntity uiTransform={{ positionType: 'absolute', position: { left: 0, top: 0 }, width: px(FW), height: px(FH) }}>{children}</UiEntity>
  )
  if (s.phase === 'title') {
    return layer([
      label('t1', 'VOID RACER', 26, 46, FRAME),
      label('t2', 'Race the neon highway through the void', 92, 17, DIM),
      label('t3', 'UP / E  go     DOWN  brake     LEFT / RIGHT  steer', 180, 15, WHITE),
      label('t4', 'Pass rivals +100  ·  grab orbs for time  ·  miss the debris', 206, 15, WHITE),
      label('t5', 'Make each CHECKPOINT before the clock runs out', 232, 15, AMBER),
      blink ? label('t6', 'PRESS  E  OR  SPACE  TO  START', 290, 22, CYAN) : null,
      hi.score > 0 ? label('t7', `STATION HIGH SCORE  ${hi.score}  ${hi.name}`, 330, 16, AMBER) : null
    ].filter(Boolean))
  }
  if (s.phase === 'over') {
    const best = s.score > 0 && s.score >= hi.score
    return layer([
      label('o1', 'TIME UP', 70, 46, PINK),
      label('o2', `SCORE  ${s.score}     DISTANCE  ${Math.floor(s.z)}`, 140, 22, WHITE),
      best ? label('o3', 'NEW STATION HIGH SCORE!', 176, 20, AMBER) : null,
      blink ? label('o4', 'E / SPACE  RACE AGAIN     F  LEAVE', 230, 18, CYAN) : null
    ].filter(Boolean))
  }
  if (s.flash && s.flashTime > 0) return layer([label('f1', s.flash, 60, s.flash === 'CHECKPOINT!' ? 34 : 22, s.flash === 'CHECKPOINT!' ? AMBER : CYAN)])
  return null
}

function Dash() {
  const s = racer()
  const hi = racerHiScore()
  const cell = (key: string, name: string, value: string, color: Color4) => (
    <UiEntity key={key} uiTransform={{ flexDirection: 'column', alignItems: 'center', width: px(FW / 5) }}>
      <Label value={name} fontSize={px(12)} color={DIM} />
      <Label value={value} fontSize={px(20)} color={color} />
    </UiEntity>
  )
  const low = s.time <= 10 && Math.floor(Date.now() / 250) % 2 === 0
  return (
    <UiEntity uiTransform={{ flexDirection: 'row', width: px(FW), height: px(52), margin: { bottom: px(6) } }}>
      {cell('time', 'TIME', `${Math.ceil(s.time)}`, low ? PINK : AMBER)}
      {cell('speed', 'SPEED', `${Math.round(s.speed * 5)} km/h`, CYAN)}
      {cell('score', 'SCORE', `${s.score}`, WHITE)}
      {cell('hi', 'STATION HI', hi.score > 0 ? `${hi.score}` : '-', AMBER)}
      {cell('next', 'NEXT CHECK', `${Math.max(0, Math.ceil(s.checkpoint - s.z))} m`, DIM)}
    </UiEntity>
  )
}

export function RacerScreen() {
  if (!isPlayingRacer()) return null
  const best = racerBest()
  return (
    <UiEntity uiTransform={{ positionType: 'absolute', width: '100%', height: '100%', justifyContent: 'center', alignItems: 'center' }}>
      <UiEntity
        uiTransform={{ flexDirection: 'column', alignItems: 'center', padding: px(16), borderWidth: px(3), borderColor: FRAME }}
        uiBackground={{ color: BG }}
      >
        <Dash />
        <UiEntity uiTransform={{ width: px(FW), height: px(FH), overflow: 'hidden' }}>
          <Road />
          <Overlay />
        </UiEntity>
        <UiEntity uiTransform={{ flexDirection: 'row', width: px(FW), height: px(40), margin: { top: px(8) }, justifyContent: 'space-between', alignItems: 'center' }}>
          <Label value={`UP / E  GO    DOWN  BRAKE    LEFT / RIGHT  STEER${best > 0 ? `    BEST ${best}` : ''}`} fontSize={px(14)} color={DIM} textAlign="middle-left" />
          <UiEntity
            uiTransform={{ padding: { left: px(12), right: px(12) }, height: px(32), alignItems: 'center' }}
            uiBackground={{ color: Color4.create(1, 1, 1, 0.08) }}
            onMouseDown={() => quitRacer()}
          >
            <Label value="F  LEAVE" fontSize={px(14)} color={CYAN} />
          </UiEntity>
        </UiEntity>
      </UiEntity>
    </UiEntity>
  )
}
