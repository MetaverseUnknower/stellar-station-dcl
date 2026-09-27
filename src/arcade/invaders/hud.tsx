// PETAL INVADERS' screen, drawn in the HUD while the player is at the cabinet: the field in blocky pixel style
// (every sprite is a few solid boxes), a score bar on top, the controls underneath.
import ReactEcs, { UiEntity, Label } from '@dcl/sdk/react-ecs'
import { Color4 } from '@dcl/sdk/math'
import { px } from '../../uiScale'
import {
  W, H, ALIEN_W, ALIEN_H, SHIP_Y, SHIP_W, SHIP_H, SHOT_W, SHOT_H, BOMB_W, BOMB_H, BUNKER_CELL, COMET_W, COMET_H, ROW_POINTS
} from './game'
import { invaders, isPlayingInvaders, invadersHiScore, invadersBest, quitInvaders } from './play'

const U = 24 // pixels per field unit (at 1080p)
const BG = Color4.create(0.01, 0.0, 0.04, 0.96)
const FRAME = Color4.create(1, 0.22, 0.7, 1)
const CYAN = Color4.create(0.2, 0.9, 1, 1)
const PINK = Color4.create(1, 0.22, 0.7, 1)
const AMBER = Color4.create(1, 0.7, 0.15, 1)
const DIM = Color4.create(0.6, 0.6, 0.8, 1)
const WHITE = Color4.White()
const DARK = Color4.create(0.02, 0, 0.06, 1)
const ROW_COLOURS = [
  Color4.create(1, 0.3, 0.75, 1),
  Color4.create(0.65, 0.35, 1, 1),
  Color4.create(0.65, 0.35, 1, 1),
  Color4.create(0.25, 1, 0.65, 1),
  Color4.create(0.25, 1, 0.65, 1)
]

function box(key: string, x: number, y: number, w: number, h: number, color: Color4) {
  return (
    <UiEntity
      key={key}
      uiTransform={{ positionType: 'absolute', position: { left: px(x * U), top: px(y * U) }, width: px(w * U), height: px(h * U) }}
      uiBackground={{ color }}
    />
  )
}

function text(key: string, value: string, x: number, y: number, size: number, color: Color4, w = W) {
  return (
    <UiEntity key={key} uiTransform={{ positionType: 'absolute', position: { left: px(x * U), top: px(y * U) }, width: px(w * U), height: px(size * 1.4) }}>
      <Label value={value} fontSize={px(size)} color={color} textAlign="middle-center" uiTransform={{ width: '100%', height: '100%' }} />
    </UiEntity>
  )
}

/** An aphid: a round-ish body, dark eyes, legs that tuck and splay as the formation steps. */
function alien(key: string, x: number, y: number, row: number, frame: number) {
  const c = ROW_COLOURS[row]
  const legOut = frame === 0 ? 0 : 0.15
  return [
    box(`${key}b`, x + 0.1, y, ALIEN_W - 0.2, ALIEN_H - 0.25, c),
    box(`${key}w`, x, y + 0.15, ALIEN_W, 0.35, c),
    box(`${key}e`, x + 0.3, y + 0.2, ALIEN_W - 0.6, 0.15, DARK),
    box(`${key}l`, x + 0.05 - legOut, y + ALIEN_H - 0.25, 0.2, 0.25, c),
    box(`${key}r`, x + ALIEN_W - 0.25 + legOut, y + ALIEN_H - 0.25, 0.2, 0.25, c)
  ]
}

/** The petal ship: a wide base, a raised petal, a glowing tip. */
function ship(key: string, cx: number, colour: Color4) {
  return [
    box(`${key}a`, cx - SHIP_W / 2, SHIP_Y + 0.45, SHIP_W, SHIP_H - 0.45, colour),
    box(`${key}b`, cx - 0.4, SHIP_Y + 0.15, 0.8, 0.35, colour),
    box(`${key}c`, cx - 0.12, SHIP_Y - 0.1, 0.24, 0.3, CYAN)
  ]
}

function Field() {
  const s = invaders()
  const out: ReturnType<typeof box>[] = []
  if (s.phase !== 'title') {
    s.aliens.forEach((a, i) => { if (a.alive) out.push(...alien(`a${i}`, a.x, a.y, a.row, s.stepFrame)) })
    s.bunkers.forEach((c, i) => out.push(box(`k${i}`, c.x, c.y, BUNKER_CELL, BUNKER_CELL, Color4.create(0.2, 0.8, 0.35, c.hp >= 2 ? 1 : 0.45))))
    s.shots.forEach((b, i) => out.push(box(`s${i}`, b.x, b.y, SHOT_W, SHOT_H, CYAN)))
    s.bombs.forEach((b, i) => out.push(box(`m${i}`, b.x + (Math.floor(b.y * 3) % 2 ? 0.08 : -0.08), b.y, BOMB_W, BOMB_H, AMBER)))
    if (s.comet) {
      const c = s.comet
      const tail = -c.dir
      out.push(box('ct1', c.x + tail * 0.9, c.y + 0.2, COMET_W, COMET_H - 0.4, Color4.create(1, 0.6, 0.1, 0.35)))
      out.push(box('ct0', c.x + tail * 0.45, c.y + 0.1, COMET_W, COMET_H - 0.2, Color4.create(1, 0.7, 0.15, 0.6)))
      out.push(box('cb', c.x, c.y, COMET_W, COMET_H, AMBER))
      out.push(box('cc', c.x + 0.5, c.y + 0.2, COMET_W - 1, COMET_H - 0.4, WHITE))
    }
    const flashing = s.shipFlash > 0 && Math.floor(s.shipFlash * 10) % 2 === 0
    if (s.phase !== 'over' && !flashing) out.push(...ship('ship', s.shipX, PINK))
    s.popped.forEach((p, i) => {
      if (p.text) out.push(text(`p${i}`, p.text, p.x - 2, p.y - 0.4, 18, AMBER, 4))
      else {
        const r = 0.9 - p.t * 2
        out.push(box(`p${i}h`, p.x - r, p.y - 0.08, r * 2, 0.16, WHITE))
        out.push(box(`p${i}v`, p.x - 0.08, p.y - r, 0.16, r * 2, WHITE))
      }
    })
    // The garden line the ship defends.
    out.push(box('ground', 0, H - 0.5, W, 0.12, Color4.create(0.2, 0.8, 0.35, 0.8)))
  }
  return <UiEntity uiTransform={{ width: px(W * U), height: px(H * U), positionType: 'relative' }}>{out}</UiEntity>
}

function Overlay() {
  const s = invaders()
  const hi = invadersHiScore()
  if (s.phase === 'title') {
    return (
      <UiEntity uiTransform={{ positionType: 'absolute', position: { left: 0, top: 0 }, width: px(W * U), height: px(H * U) }}>
        {text('t1', 'PETAL INVADERS', 0, 3, 46, PINK)}
        {text('t2', 'Defend the station garden', 0, 5.6, 18, DIM)}
        {[...alien('d0', 6.5, 9, 0, 0), ...alien('d1', 6.5, 11, 1, 0), ...alien('d2', 6.5, 13, 3, 0)]}
        {text('t3', `= ${ROW_POINTS[0]} PTS`, 8.5, 9, 20, WHITE, 6)}
        {text('t4', `= ${ROW_POINTS[1]} PTS`, 8.5, 11, 20, WHITE, 6)}
        {text('t5', `= ${ROW_POINTS[3]} PTS`, 8.5, 13, 20, WHITE, 6)}
        {box('d3', 6.2, 15.2, COMET_W, COMET_H, AMBER)}
        {text('t6', '= ??? PTS', 8.5, 15, 20, WHITE, 6)}
        {Math.floor(Date.now() / 500) % 2 === 0 ? text('t7', 'PRESS  E  OR  SPACE  TO  START', 0, 19, 22, CYAN) : null}
        {hi.score > 0 ? text('t8', `STATION HIGH SCORE  ${hi.score}  ${hi.name}`, 0, 21.3, 16, AMBER) : null}
      </UiEntity>
    )
  }
  if (s.phase === 'over') {
    const best = s.score > 0 && s.score >= hi.score
    return (
      <UiEntity uiTransform={{ positionType: 'absolute', position: { left: 0, top: 0 }, width: px(W * U), height: px(H * U) }}>
        {text('o1', 'GAME OVER', 0, 8, 46, PINK)}
        {text('o2', `SCORE  ${s.score}`, 0, 11, 26, WHITE)}
        {best ? text('o3', 'NEW STATION HIGH SCORE!', 0, 13, 22, AMBER) : null}
        {Math.floor(Date.now() / 500) % 2 === 0 ? text('o4', 'E / SPACE  PLAY AGAIN     F  LEAVE', 0, 17, 20, CYAN) : null}
      </UiEntity>
    )
  }
  if (s.phase === 'cleared') {
    return (
      <UiEntity uiTransform={{ positionType: 'absolute', position: { left: 0, top: 0 }, width: px(W * U), height: px(H * U) }}>
        {text('c1', `WAVE ${s.wave} CLEARED`, 0, 10, 32, CYAN)}
      </UiEntity>
    )
  }
  return null
}

function ScoreBar() {
  const s = invaders()
  const hi = invadersHiScore()
  const cell = (key: string, label: string, value: string, color: Color4) => (
    <UiEntity key={key} uiTransform={{ flexDirection: 'column', alignItems: 'center', width: px(W * U / 4) }}>
      <Label value={label} fontSize={px(13)} color={DIM} />
      <Label value={value} fontSize={px(22)} color={color} />
    </UiEntity>
  )
  return (
    <UiEntity uiTransform={{ flexDirection: 'row', width: px(W * U), height: px(56), margin: { bottom: px(6) } }}>
      {cell('score', 'SCORE', `${s.score}`, WHITE)}
      {cell('hi', 'STATION HI', hi.score > 0 ? `${hi.score}` : '-', AMBER)}
      {cell('wave', 'WAVE', `${s.wave}`, CYAN)}
      {cell('lives', 'SHIPS', `${Math.max(0, s.lives)}`, PINK)}
    </UiEntity>
  )
}

export function InvadersScreen() {
  if (!isPlayingInvaders()) return null
  const best = invadersBest()
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
          <Label value={`A / D  (or 1 / 2)  MOVE    E / SPACE  FIRE${best > 0 ? `    BEST ${best}` : ''}`} fontSize={px(14)} color={DIM} textAlign="middle-left" />
          <UiEntity
            uiTransform={{ padding: { left: px(12), right: px(12) }, height: px(32), alignItems: 'center' }}
            uiBackground={{ color: Color4.create(1, 1, 1, 0.08) }}
            onMouseDown={() => quitInvaders()}
          >
            <Label value="F  LEAVE" fontSize={px(14)} color={CYAN} />
          </UiEntity>
        </UiEntity>
      </UiEntity>
    </UiEntity>
  )
}
