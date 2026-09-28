// DEX's speech: a holographic readout over his head, not a plain caption. A dark translucent panel with a cyan frame,
// a small "DEX-7 // VOX" tag, and his words in monospace, typed out a character at a time like a terminal; whispers
// in italics, dimmer. It turns to face you (Billboard), sizes itself to the line, and clears itself after a while.
// Sizes are worked out from the monospace font's advance (about 0.6 em, an em being a tenth of the font size in
// metres), since a TextShape can't report its own size.
import { engine, Entity, Transform, TextShape, Font, TextAlignMode, MeshRenderer, Material, MaterialTransparencyMode, Billboard, BillboardMode } from '@dcl/sdk/ecs'
import { Vector3, Color3, Color4 } from '@dcl/sdk/math'

/** A line to say: plain, or whispered. */
export type Line = string | { whisper: string }
export const whisper = (text: string): Line => ({ whisper: text })

const FONT = 1.1
const CHAR_W = 0.06 * FONT // metres per character (generous, so the text never runs off the panel)
const LINE_H = 0.14 * FONT
const MAX_CHARS = 24 // per line, wrapped at words
const PAD = 0.1
const TAG_H = 0.12
const EDGE = 0.012
const CHARS_PER_SECOND = 45
const HOLD_SECONDS = 4.5 // after it's all typed out

const TEXT = Color4.create(0.75, 0.97, 1, 1)
const WHISPER = Color4.create(0.55, 0.72, 0.8, 1)
const CYAN = Color3.create(0.2, 0.9, 1)

function wrap(text: string): string[] {
  const lines: string[] = []
  let line = ''
  for (const word of text.split(' ')) {
    if (line && (line + ' ' + word).length > MAX_CHARS) {
      lines.push(line)
      line = word
    } else {
      line = line ? line + ' ' + word : word
    }
  }
  if (line) lines.push(line)
  return lines
}

export type Bubble = { say: (line: Line) => void; speaking: () => boolean }

/** A bubble whose bottom edge sits at `position` (in `parent`'s space). */
export function createBubble(parent: Entity, position: Vector3): Bubble {
  const anchor = engine.addEntity()
  Transform.create(anchor, { parent, position })
  Billboard.create(anchor, { billboardMode: BillboardMode.BM_Y })
  const group = engine.addEntity() // scaled to nothing while he's quiet
  Transform.create(group, { parent: anchor, scale: Vector3.Zero() })

  // Text reads from its -Z side, which faces you; the panel goes just behind it (+Z)
  const panel = engine.addEntity()
  Transform.create(panel, { parent: group, position: Vector3.create(0, 0, 0.02) })
  MeshRenderer.setPlane(panel)
  Material.setPbrMaterial(panel, {
    albedoColor: Color4.create(0.02, 0.05, 0.12, 0.88),
    emissiveColor: Color3.create(0.02, 0.08, 0.16),
    emissiveIntensity: 1,
    transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND
  })
  const edges = [0, 1, 2, 3].map(() => {
    const e = engine.addEntity()
    Transform.create(e, { parent: group })
    MeshRenderer.setPlane(e)
    Material.setPbrMaterial(e, { albedoColor: Color4.create(CYAN.r, CYAN.g, CYAN.b, 1), emissiveColor: CYAN, emissiveIntensity: 3 })
    return e
  })
  const tag = engine.addEntity()
  Transform.create(tag, { parent: group })
  TextShape.create(tag, { text: 'DEX-7 // VOX', fontSize: 0.6, font: Font.F_MONOSPACE, textColor: Color4.create(0.2, 0.9, 1, 0.8), textAlign: TextAlignMode.TAM_MIDDLE_LEFT })
  const words = engine.addEntity()
  Transform.create(words, { parent: group })
  TextShape.create(words, { text: '', fontSize: FONT, font: Font.F_MONOSPACE, textColor: TEXT, textAlign: TextAlignMode.TAM_TOP_LEFT })

  let full = ''
  let whispered = false
  let typed = 0
  let hold = 0

  function layout(lines: string[]): void {
    const cols = Math.max(8, ...lines.map((l) => l.length))
    const w = cols * CHAR_W + 2 * PAD
    const h = lines.length * LINE_H + TAG_H + 2 * PAD
    const g = Transform.getMutable(group)
    g.position = Vector3.create(0, h / 2, 0)
    g.scale = Vector3.One()
    Transform.getMutable(panel).scale = Vector3.create(w, h, 1)
    const frame = [
      { p: Vector3.create(0, h / 2, 0.01), s: Vector3.create(w + EDGE, EDGE, 1) },
      { p: Vector3.create(0, -h / 2, 0.01), s: Vector3.create(w + EDGE, EDGE, 1) },
      { p: Vector3.create(-w / 2, 0, 0.01), s: Vector3.create(EDGE, h + EDGE, 1) },
      { p: Vector3.create(w / 2, 0, 0.01), s: Vector3.create(EDGE, h + EDGE, 1) }
    ]
    frame.forEach(({ p, s }, i) => {
      const t = Transform.getMutable(edges[i])
      t.position = p
      t.scale = s
    })
    const top = h / 2 - PAD
    Transform.getMutable(tag).position = Vector3.create(0, top - TAG_H / 2 + 0.02, 0)
    const tagBox = TextShape.getMutable(tag)
    tagBox.width = w - 2 * PAD
    tagBox.height = TAG_H
    // The text box, top-left aligned, spans the content area below the tag
    const box = TextShape.getMutable(words)
    box.width = w - 2 * PAD
    box.height = h - 2 * PAD - TAG_H
    Transform.getMutable(words).position = Vector3.create(0, -TAG_H / 2, 0)
  }

  function say(line: Line): void {
    whispered = typeof line !== 'string'
    const text = typeof line === 'string' ? line : line.whisper
    const lines = wrap(text)
    full = lines.join('\n')
    typed = 0
    hold = HOLD_SECONDS
    const ts = TextShape.getMutable(words)
    ts.text = ''
    ts.textColor = whispered ? WHISPER : TEXT
    if (!full) {
      Transform.getMutable(group).scale = Vector3.Zero()
      return
    }
    layout(lines)
  }

  let blink = 0
  engine.addSystem((dt) => {
    if (!full) return
    blink += dt
    if (typed < full.length) {
      typed = Math.min(full.length, typed + dt * CHARS_PER_SECOND)
    } else {
      hold -= dt
      if (hold <= 0) {
        full = ''
        Transform.getMutable(group).scale = Vector3.Zero()
        return
      }
    }
    const shown = full.slice(0, Math.floor(typed))
    const cursor = typed < full.length || Math.floor(blink * 2) % 2 === 0 ? '_' : ' '
    const text = whispered ? `<i>${shown}</i>${cursor}` : shown + cursor
    if (TextShape.get(words).text !== text) TextShape.getMutable(words).text = text
  })

  return { say, speaking: () => full !== '' }
}
