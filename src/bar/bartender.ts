// The Space Bar's robot bartenders (tools/build_bartender.py), either side of the back bar's centre bay. Each hovers
// behind the counter, follows whoever's nearest with its head, blinks, talks in a readout over its head
// (speechBubble.ts) and, clicked, hands over the menu (menuUi.tsx); drinks are shaken, then served into your hand
// (drinks.ts). The fourth thing on the menu isn't a drink: it's the way into the back room (secretDoor.ts), and each of
// them handles that in character:
//   DEX, the mid-century one with the bow tie: gives you a dirty look, then gets shifty (checks nobody's watching,
//        drops his voice, asks if you were followed) before opening up; afterwards he never saw you, and he mutters
//        that the shelves are just shelves.
//   BLIP, small, round and pastel: thrilled someone ordered the special, waves you through, asks how it went, and all
//        but tells everyone about the secret menu.
import { engine, Entity, Transform, GltfContainer, ColliderLayer, MeshRenderer, Material, pointerEventsSystem, InputAction } from '@dcl/sdk/ecs'
import { Vector3, Quaternion, Color3, Color4 } from '@dcl/sdk/math'
import { CENTER, FLOOR_Y } from '../station'
import { Drink, holdDrink, startDrinks, holdingDrink, handBack } from './drinks'
import { unlockBackRoom, doorState, onDoorChanged } from './secretDoor'
import { createBubble, whisper, Line, BubbleStyle } from './speechBubble'

const LOUNGE = 25 // build_station_models.py LOUNGE
const RADIUS = 26.2 // in the aisle between the counter (25.4) and the back bar (26.9)
const LOOK_RANGE = 9
const MAX_TURN = 70 // degrees the head turns either way
const SHAKE_SECONDS = 1.6
const RECENT_SECONDS = 120 // after you've come out of the back room, for this long it's "recent"
const MUTTER_NEAR = 6 // metres: close enough to overhear
const SCOWL = 20 // degrees each of DEX's eyes tilts, inner end down, for a dirty look
const LEAN = 0.08 // metres DEX leans in when he's glaring

const pick = <T,>(lines: T[]) => lines[Math.floor(Math.random() * lines.length)]

/** A little scene: lines at set times, moods for a while, and something to do at the end. */
type Beat = { at: number; say?: Line; nervous?: number; glare?: number; happy?: number; then?: () => void }

type Personality = {
  name: string
  angle: number // scene degrees, behind the counter, 2 m either side of the centre bay (clear of its leaves' swing)
  neck: number // build_bartender.py NECK / BLIP_NECK
  hand: Vector3 // HAND / BLIP_HAND, (x, y, z) Blender as (-x, z, -y)
  body: string
  head: string
  eyes: 'visor' | 'round'
  bubble: BubbleStyle
  bob: number // how far it bobs as it hovers
  greetings: string[]
  preparing: string
  served: (drink: Drink) => string
  /** The Vacuum on the Rocks, hold the rocks: `open` if the back bar's already open for you, `recent` if you've just come out. */
  secret: (open: boolean, recent: boolean) => Beat[]
  whenOpen: Line // clicked while the back bar's open for you
  afterwards: string[] // clicked soon after you've come out
  welcomeBack: string[] // as you come out
  wandered: string // you asked, then wandered off
  another: string // clicked while you're holding a drink: would you like another?
  tookGlass: string // taking your glass back
  mutters: string[]
  jittery: boolean // glances about when it mutters
}

const DEX: Personality = {
  name: 'DEX',
  angle: 239.4,
  neck: 1.62,
  hand: Vector3.create(0.3, 1.08, 0.36),
  body: 'assets/models/bartender_body.glb',
  head: 'assets/models/bartender_head.glb',
  eyes: 'visor',
  bubble: { tag: 'DEX-7 // VOX', edge: Color3.create(0.2, 0.9, 1), text: Color4.create(0.75, 0.97, 1, 1), panel: Color4.create(0.015, 0.035, 0.08, 1) },
  bob: 0.02,
  greetings: ['What can I get you?', 'What’ll it be?', 'Evening. Drink?', 'Name your poison. Non-toxic, obviously.'],
  preparing: 'Coming right up.',
  served: (d) => d.served,
  secret: (open, recent) =>
    open
      ? [{ at: 0, say: whisper('I heard you the first time. Go.'), glare: 1.5 }]
      : recent
        ? [
            { at: 0, say: '…Again?', glare: 1.8 },
            { at: 1.8, say: whisper('Fine. Quick. Nobody’s looking.'), nervous: 1.2, then: unlockBackRoom }
          ]
        : [
            { at: 0, say: '…', glare: 2.4 },
            { at: 2.4, say: whisper('Keep your voice down.'), nervous: 2 },
            { at: 4.6, say: whisper('Vacuum on the Rocks. Hold the rocks. Right.') },
            { at: 7.0, say: whisper('Nobody followed you?'), nervous: 2.2 },
            { at: 9.2, say: whisper('…Through the back. Be quick.'), then: unlockBackRoom }
          ],
  whenOpen: whisper('Why are you still standing here? Go.'),
  afterwards: ['I don’t know what you’re talking about.', 'Back room? What back room?', 'Those are shelves. Just shelves.'],
  welcomeBack: ['Never saw you.', 'You were never here.', 'Who are you again? Never mind. Don’t tell me.', 'I didn’t see a thing.'],
  wandered: 'Suit yourself.',
  another: 'Another?',
  tookGlass: 'I\u2019ll take that.',
  mutters: [
    'Those shelves are just shelves.',
    'Nothing back there but stock.',
    'Don’t lean on the back bar.',
    'I’ve never heard of anyone called the Eld.',
    'Lovely evening. Nothing unusual.',
    'The back bar is load-bearing. Probably.',
    'Don’t listen to BLIP. She tells everyone everything.'
  ],
  jittery: true
}

const BLIP_SERVED: Record<string, string> = {
  helium3: 'One Helium-3 Fizz! Extra bubbles, just for you.',
  plasma: 'A Plasma Crystal! It glows, see?',
  mythic: 'A Mythic Bloom! I put extra glitter in it.'
}

const BLIP: Personality = {
  name: 'BLIP',
  angle: 230.6,
  neck: 1.44,
  hand: Vector3.create(0.29, 1.03, 0.25),
  body: 'assets/models/blip_body.glb',
  head: 'assets/models/blip_head.glb',
  eyes: 'round',
  bubble: { tag: 'BLIP // hi!!', edge: Color3.create(1, 0.45, 0.65), text: Color4.create(1, 0.93, 0.96, 1), panel: Color4.create(0.1, 0.03, 0.08, 1) },
  bob: 0.035,
  greetings: ['Hi hi! What can I get you?', 'Welcome to the Space Bar!', 'Hello, friend! Thirsty?', 'Ooh, a customer! Hi!'],
  preparing: 'Ooh, good choice!',
  served: (d) => BLIP_SERVED[d.id] ?? d.served,
  secret: (open, recent) =>
    open
      ? [{ at: 0, say: 'It’s already open, silly! Go on!', happy: 1.2 }]
      : recent
        ? [{ at: 0, say: 'Back for more? Okay!', happy: 1.5, then: unlockBackRoom }]
        : [
            { at: 0, say: 'Ooh! The special!!', happy: 1.8 },
            { at: 1.8, say: 'Nobody ever orders it. I love it.' },
            { at: 3.8, say: 'The back bar’s open. Say hi to the Eld for me!', happy: 1.5, then: unlockBackRoom }
          ],
  whenOpen: 'It’s open! Right behind me!',
  afterwards: ['Wasn’t that fun?', 'The Eld are lovely once you get to know them!', 'Did you bring me anything back?'],
  welcomeBack: ['Welcome back! How was it?', 'Did they like you? I bet they liked you.', 'Ooh, you smell like cosmic radiation!', 'Yay, you’re back!'],
  wandered: 'Aww, maybe next time!',
  another: 'Ooh, ready for another?',
  tookGlass: 'Thank you! Did you like it?',
  mutters: [
    'Have you tried the Mythic Bloom? It sparkles!',
    'I polished every glass today!',
    'Psst. There’s a secret on the menu.',
    'DEX is a sweetie really. Just very private.',
    'I love it here!',
    'Ask me about the special!'
  ],
  jittery: false
}

/** The menu (or, holding a drink, "would you like another?" first), and which bartender it's from. */
export const barMenu = { open: false, asking: false, from: 'DEX' }

type Bartender = { order: (drink: Drink) => void; takeGlass: () => void }
const bartenders = new Map<string, Bartender>()
let seller: string | null = null // who opened the back bar for you last

export function closeBarMenu(): void {
  barMenu.open = false
  barMenu.asking = false
}

/** "Would you like another?": yes, the menu. */
export function wantAnother(): void {
  barMenu.asking = false
  barMenu.open = true
}

/** "Would you like another?": no, I'm done. The bartender takes the glass. */
export function doneDrinking(): void {
  barMenu.asking = false
  bartenders.get(barMenu.from)?.takeGlass()
}

/** Order from the menu: the bartender who handed it over makes it. */
export function order(drink: Drink): void {
  barMenu.open = false
  bartenders.get(barMenu.from)?.order(drink)
}

let clock = 0
let lastExit = -Infinity

export function buildBartenders(): void {
  startDrinks()
  engine.addSystem((dt) => {
    clock += dt
  })
  onDoorChanged((from, to) => {
    if (from === 'leaving' && to === 'closed') lastExit = clock
  })
  for (const p of [DEX, BLIP]) bartenders.set(p.name, buildBartender(p))
}

function buildBartender(p: Personality): Bartender {
  const a = (p.angle * Math.PI) / 180
  const base = Vector3.create(CENTER.x + Math.cos(a) * RADIUS, FLOOR_Y + LOUNGE, CENTER.z + Math.sin(a) * RADIUS)
  // Faces the hub's centre. The models face scene +Z; a yaw turns +Z toward +X.
  const facing = (Math.atan2(CENTER.x - base.x, CENTER.z - base.z) * 180) / Math.PI
  const fwd = Vector3.normalize(Vector3.create(CENTER.x - base.x, 0, CENTER.z - base.z))

  const root = engine.addEntity() // bobs up and down; everything hangs off it
  Transform.create(root, { position: base, rotation: Quaternion.fromEulerDegrees(0, facing, 0) })
  const body = engine.addEntity()
  Transform.create(body, { parent: root })
  GltfContainer.create(body, { src: p.body, visibleMeshesCollisionMask: ColliderLayer.CL_POINTER | ColliderLayer.CL_PHYSICS })
  const head = engine.addEntity()
  Transform.create(head, { parent: root, position: Vector3.create(0, p.neck, 0) })
  GltfContainer.create(head, { src: p.head, visibleMeshesCollisionMask: ColliderLayer.CL_POINTER })
  const shaker = engine.addEntity()
  Transform.create(shaker, { parent: root, position: p.hand })
  GltfContainer.create(shaker, { src: 'assets/models/bartender_shaker.glb' })

  // Eyes, drawn here so they can blink (and scowl, or squint with joy). DEX's are bars on his visor; BLIP's are big
  // glowing ovals on her face screen, with a highlight each.
  const EYE = p.eyes === 'visor'
    ? { y: 0.15, z: 0.2, x: 0.065, w: 0.06, h: 0.035, d: 0.01 }
    : { y: 0.2, z: 0.222, x: 0.065, w: 0.1, h: 0.124, d: 0.024 }
  const glow = p.eyes === 'visor' ? Color3.create(0.3, 0.95, 1) : Color3.create(0.45, 0.95, 1)
  const eyes: Entity[] = [-1, 1].map((sgn) => {
    const e = engine.addEntity()
    Transform.create(e, { parent: head, position: Vector3.create(sgn * EYE.x, EYE.y, EYE.z), scale: Vector3.create(EYE.w, EYE.h, EYE.d) })
    if (p.eyes === 'visor') MeshRenderer.setBox(e)
    else MeshRenderer.setSphere(e)
    Material.setPbrMaterial(e, { albedoColor: Color4.create(glow.r, glow.g, glow.b, 1), emissiveColor: glow, emissiveIntensity: 4 })
    if (p.eyes === 'round') {
      const shine = engine.addEntity()
      Transform.create(shine, { parent: head, position: Vector3.create(sgn * EYE.x + 0.018, EYE.y + 0.025, EYE.z + 0.012), scale: Vector3.create(0.024, 0.024, 0.01) })
      MeshRenderer.setSphere(shine)
      Material.setPbrMaterial(shine, { albedoColor: Color4.White(), emissiveColor: Color3.White(), emissiveIntensity: 5 })
    }
    return e
  })

  const bubble = createBubble(root, Vector3.create(0, p.neck + (p.eyes === 'round' ? 0.72 : 0.58), 0), p.bubble)
  const say = bubble.say

  let shaking = 0
  let pending: Drink | null = null
  let script: Beat[] = []
  let scriptT = 0
  let nervous = 0 // glancing about
  let glare = 0 // a dirty look
  let happy = 0 // eyes squeezed shut with joy, a wiggle
  const run = (beats: Beat[]) => {
    script = beats
    scriptT = 0
  }
  const recent = () => clock - lastExit < RECENT_SECONDS

  for (const e of [body, head]) {
    pointerEventsSystem.onPointerDown(
      { entity: e, opts: { button: InputAction.IA_POINTER, hoverText: `Order a drink from ${p.name}`, maxDistance: 6, showHighlight: false } },
      () => {
        // Holding a drink: would you like another? (unless the back bar's open for you; then there's only one thing
        // worth saying)
        if (holdingDrink() && doorState() !== 'invited') {
          if (!barMenu.asking || barMenu.from !== p.name) say(p.another)
          if (p.eyes === 'round') happy = 0.8
          barMenu.open = false
          barMenu.asking = true
          barMenu.from = p.name
          return
        }
        if (!barMenu.open || barMenu.from !== p.name) {
          if (doorState() === 'invited') say(p.whenOpen)
          else if (recent() && seller === p.name) say(pick(p.afterwards))
          else say(pick(p.greetings))
          if (p.eyes === 'round') happy = 0.8
        }
        barMenu.open = true
        barMenu.from = p.name
      }
    )
  }

  // The back room's comings and goings: the one who let you in has something to say
  onDoorChanged((from, to) => {
    if (seller !== p.name) return
    if (from === 'leaving' && to === 'closed') run([{ at: 0.6, say: pick(p.welcomeBack), nervous: p.jittery ? 1.8 : 0, happy: p.jittery ? 0 : 1.2 }])
    else if (from === 'invited' && to === 'closed') run([{ at: 0, say: p.wandered }])
  })

  let t = Math.random() * 10
  let blink = 3
  let headYaw = 0
  let mutter = 30 + Math.random() * 40
  let lean = 0
  let scowling = false
  engine.addSystem((dt) => {
    t += dt
    // Hovering (a happy hop when delighted), leaning in when glaring
    lean += ((glare > 0 ? LEAN : 0) - lean) * Math.min(1, dt * 6)
    const hop = happy > 0 ? Math.abs(Math.sin(t * 9)) * 0.05 : 0
    Transform.getMutable(root).position = Vector3.create(base.x + fwd.x * lean, base.y + Math.sin(t * 1.7) * p.bob + hop, base.z + fwd.z * lean)

    // The head turns toward me when I'm near and wanders a little when I'm not; darts about when nervous; stares me
    // down when glaring; wiggles when happy
    const me = Transform.getOrNull(engine.PlayerEntity)
    let want = Math.sin(t * 0.3) * 25
    if (me && Vector3.distance(me.position, base) < LOOK_RANGE) {
      const toMe = (Math.atan2(me.position.x - base.x, me.position.z - base.z) * 180) / Math.PI
      want = ((toMe - facing + 540) % 360) - 180
    }
    if (glare > 0) {
      glare -= dt
    } else if (nervous > 0) {
      nervous -= dt
      want = Math.sin(t * 5) > 0 ? MAX_TURN : -MAX_TURN
    }
    if (happy > 0) happy -= dt
    want = Math.max(-MAX_TURN, Math.min(MAX_TURN, want))
    headYaw += (want - headYaw) * Math.min(1, dt * (nervous > 0 || glare > 0 ? 9 : 4))
    const roll = happy > 0 ? Math.sin(t * 7) * 12 : p.eyes === 'round' ? Math.sin(t * 0.8) * 5 : 0 // BLIP tilts her head
    Transform.getMutable(head).rotation = Quaternion.fromEulerDegrees(0, headYaw, roll)

    // Eyes: a blink now and then; DEX's narrow when he's shifty, and narrow and tilt for a dirty look; BLIP's squeeze
    // into happy arcs
    blink -= dt
    const shut = blink < 0.12
    if (blink < 0) blink = 2.5 + Math.random() * 3
    const h = shut ? EYE.h * 0.15 : glare > 0 ? EYE.h * 0.57 : nervous > 0 ? EYE.h * 0.46 : happy > 0 ? EYE.h * 0.3 : EYE.h
    for (const e of eyes) {
      if (Transform.get(e).scale.y !== h) Transform.getMutable(e).scale = Vector3.create(EYE.w, h, EYE.d)
    }
    if ((glare > 0) !== scowling) {
      scowling = glare > 0
      // Seen from the front, a positive roll turns an eye clockwise; the eye at +x is on the viewer's left.
      eyes.forEach((e, i) => {
        const sgn = i === 0 ? -1 : 1
        Transform.getMutable(e).rotation = Quaternion.fromEulerDegrees(0, 0, scowling ? sgn * SCOWL : 0)
      })
    }

    // Shake the drink, then serve it
    if (pending) {
      shaking -= dt
      Transform.getMutable(shaker).position = Vector3.add(p.hand, Vector3.create(0, Math.sin(t * 40) * 0.06, 0))
      if (shaking <= 0) {
        Transform.getMutable(shaker).position = p.hand
        holdDrink(pending)
        say(p.served(pending))
        if (p.eyes === 'round') happy = 1
        pending = null
      }
    }

    // Play out a script, beat by beat
    if (script.length) {
      scriptT += dt
      while (script.length && script[0].at <= scriptT) {
        const beat = script.shift() as Beat
        if (beat.say !== undefined) say(beat.say)
        if (beat.nervous) nervous = beat.nervous
        if (beat.glare) glare = beat.glare
        if (beat.happy) happy = beat.happy
        beat.then?.()
      }
    }

    // Now and then, to anyone close enough to hear
    mutter -= dt
    if (mutter <= 0) {
      mutter = 40 + Math.random() * 40
      if (me && Vector3.distance(me.position, base) < MUTTER_NEAR && !bubble.speaking() && !script.length && Math.random() < 0.6) {
        say(pick(p.mutters))
        if (p.jittery) nervous = 1.2
      }
    }

    // Walk away and the menu goes back behind the bar
    if ((barMenu.open || barMenu.asking) && barMenu.from === p.name && me && Vector3.distance(me.position, base) > LOOK_RANGE) closeBarMenu()
  })

  return {
    takeGlass() {
      handBack()
      say(p.tookGlass)
      if (p.eyes === 'round') happy = 1
    },
    order(drink: Drink) {
      if (!drink.glass) {
        if (doorState() === 'closed') seller = p.name
        run(p.secret(doorState() === 'invited', recent()))
        return
      }
      say(p.preparing)
      if (p.eyes === 'round') happy = 0.8
      shaking = SHAKE_SECONDS
      pending = drink
    }
  }
}
