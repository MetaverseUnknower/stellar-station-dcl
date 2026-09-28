// DEX, the Space Bar's robot bartender (tools/build_bartender.py): he hovers behind the counter beside the back bar's
// centre bay, follows whoever's nearest with his head, blinks, and, clicked, hands over the menu (menuUi.tsx). He
// shakes each drink before it's served into your hand (drinks.ts). The fourth thing on the menu isn't a drink: ask for
// it and he gives you a dirty look, then gets shifty (checks nobody's watching, drops his voice, asks if you were
// followed) and then opens the back bar, once (secretDoor.ts). Afterwards he never saw you, and he mutters about the
// shelves being just shelves. He talks in a holographic readout over his head (speechBubble.ts).
import { engine, Entity, Transform, GltfContainer, ColliderLayer, MeshRenderer, Material, pointerEventsSystem, InputAction } from '@dcl/sdk/ecs'
import { Vector3, Quaternion, Color3, Color4 } from '@dcl/sdk/math'
import { CENTER, FLOOR_Y } from '../station'
import { Drink, holdGlass, startDrinks } from './drinks'
import { unlockBackRoom, doorState, onDoorChanged } from './secretDoor'
import { createBubble, whisper, Line } from './speechBubble'

const LOUNGE = 25 // build_station_models.py LOUNGE
const ANGLE = 239.4 // scene degrees: behind the counter, 2 m along from the centre bay (clear of its leaves' swing)
const RADIUS = 26.2 // in the aisle between the counter (25.4) and the back bar (26.9)
const NECK = 1.62 // build_bartender.py NECK
const HAND = Vector3.create(0.3, 1.08, 0.36) // build_bartender.py HAND (-0.3, -0.36, 1.08), in scene axes
const LOOK_RANGE = 9
const MAX_TURN = 70 // degrees the head turns either way
const SHAKE_SECONDS = 1.6
const DENY_SECONDS = 120 // after you've come out, for this long he doesn't know what you're talking about
const MUTTER_NEAR = 6 // metres: close enough to overhear him

const SCOWL = 20 // degrees each eye tilts, inner end down, for a dirty look
const LEAN = 0.08 // metres he leans in when he's glaring
const pick = (lines: string[]) => lines[Math.floor(Math.random() * lines.length)]

const GREETINGS = ['What can I get you?', 'What\u2019ll it be?', 'Evening. Drink?', 'Name your poison. Non-toxic, obviously.']
const NEVER_SAW_YOU = ['Never saw you.', 'You were never here.', 'Who are you again? Never mind. Don\u2019t tell me.', 'I didn\u2019t see a thing.']
const DENIALS = ['I don\u2019t know what you\u2019re talking about.', 'Back room? What back room?', 'Those are shelves. Just shelves.']
const MUTTERS = [
  'Those shelves are just shelves.',
  'Nothing back there but stock.',
  'Don\u2019t lean on the back bar.',
  'I\u2019ve never heard of anyone called the Eld.',
  'Lovely evening. Nothing unusual.',
  'The back bar is load-bearing. Probably.'
]

/** A little scene: lines at set times, some of them nervous, with something to do at the end. */
type Beat = { at: number; say?: Line; nervous?: number; glare?: number; then?: () => void }

export const barMenu = { open: false }

let say: (line: Line) => void = () => {}
let shaking = 0
let pending: Drink | null = null
let script: Beat[] = []
let scriptT = 0
let nervous = 0 // seconds of glancing about
let glare = 0 // seconds of dirty look
let lastExit = -Infinity // (on the bartender's clock) when you last came out of the back
let clock = 0

function run(beats: Beat[]): void {
  script = beats
  scriptT = 0
}

/** The Vacuum on the Rocks, hold the rocks: a password, not a drink. */
function orderTheNothing(): void {
  if (doorState() === 'invited') {
    run([{ at: 0, say: whisper('I heard you the first time. Go.'), glare: 1.5 }])
    return
  }
  if (clock - lastExit < DENY_SECONDS) {
    run([
      { at: 0, say: '\u2026Again?', glare: 1.8 },
      { at: 1.8, say: whisper('Fine. Quick. Nobody\u2019s looking.'), nervous: 1.2, then: unlockBackRoom }
    ])
    return
  }
  run([
    { at: 0, say: '\u2026', glare: 2.4 },
    { at: 2.4, say: whisper('Keep your voice down.'), nervous: 2 },
    { at: 4.6, say: whisper('Vacuum on the Rocks. Hold the rocks. Right.') },
    { at: 7.0, say: whisper('Nobody followed you?'), nervous: 2.2 },
    { at: 9.2, say: whisper('\u2026Through the back. Be quick.'), then: unlockBackRoom }
  ])
}

export function openBarMenu(): void {
  barMenu.open = true
}

export function closeBarMenu(): void {
  barMenu.open = false
}

/** Order from the menu: DEX shakes it (or, for the fourth, doesn't) and serves it. */
export function order(drink: Drink): void {
  barMenu.open = false
  if (!drink.glass) {
    orderTheNothing()
    return
  }
  say('Coming right up.')
  shaking = SHAKE_SECONDS
  pending = drink
}

export function buildBartender(): void {
  startDrinks()
  const a = (ANGLE * Math.PI) / 180
  const base = Vector3.create(CENTER.x + Math.cos(a) * RADIUS, FLOOR_Y + LOUNGE, CENTER.z + Math.sin(a) * RADIUS)
  // Faces the hub's centre. The model faces scene +Z; a yaw turns +Z toward +X.
  const facing = (Math.atan2(CENTER.x - base.x, CENTER.z - base.z) * 180) / Math.PI

  const root = engine.addEntity() // bobs up and down; everything hangs off it
  Transform.create(root, { position: base, rotation: Quaternion.fromEulerDegrees(0, facing, 0) })
  const body = engine.addEntity()
  Transform.create(body, { parent: root })
  GltfContainer.create(body, { src: 'assets/models/bartender_body.glb', visibleMeshesCollisionMask: ColliderLayer.CL_POINTER | ColliderLayer.CL_PHYSICS })
  const head = engine.addEntity()
  Transform.create(head, { parent: root, position: Vector3.create(0, NECK, 0) })
  GltfContainer.create(head, { src: 'assets/models/bartender_head.glb', visibleMeshesCollisionMask: ColliderLayer.CL_POINTER })
  const shaker = engine.addEntity()
  Transform.create(shaker, { parent: root, position: HAND })
  GltfContainer.create(shaker, { src: 'assets/models/bartender_shaker.glb' })

  // Eyes on the visor, drawn here so they can blink
  const eyes: Entity[] = [-1, 1].map((sgn) => {
    const e = engine.addEntity()
    Transform.create(e, { parent: head, position: Vector3.create(sgn * 0.065, 0.15, 0.2), scale: Vector3.create(0.06, 0.035, 0.01) })
    MeshRenderer.setBox(e)
    Material.setPbrMaterial(e, { albedoColor: Color4.create(0.3, 0.95, 1, 1), emissiveColor: Color3.create(0.3, 0.95, 1), emissiveIntensity: 4 })
    return e
  })

  // What he says, in a readout over his head
  const bubble = createBubble(root, Vector3.create(0, NECK + 0.58, 0))
  say = bubble.say

  for (const e of [body, head]) {
    pointerEventsSystem.onPointerDown(
      { entity: e, opts: { button: InputAction.IA_POINTER, hoverText: 'Order a drink', maxDistance: 6 } },
      () => {
        if (!barMenu.open) {
          if (doorState() === 'invited') say(whisper('Why are you still standing here? Go.'))
          else if (clock - lastExit < DENY_SECONDS) say(pick(DENIALS))
          else say(pick(GREETINGS))
        }
        openBarMenu()
      }
    )
  }

  // The back room's comings and goings
  onDoorChanged((from, to) => {
    if (from === 'leaving' && to === 'closed') {
      lastExit = clock
      run([{ at: 0.6, say: pick(NEVER_SAW_YOU), nervous: 1.8 }])
    } else if (from === 'invited' && to === 'closed') {
      run([{ at: 0, say: 'Suit yourself.' }])
    }
  })

  let t = 0
  let blink = 3
  let headYaw = 0
  let mutter = 45
  let lean = 0
  let scowling = false
  const fwd = Vector3.normalize(Vector3.create(CENTER.x - base.x, 0, CENTER.z - base.z))
  engine.addSystem((dt) => {
    t += dt
    clock = t
    // He hovers, and leans in when he's glaring at you
    lean += ((glare > 0 ? LEAN : 0) - lean) * Math.min(1, dt * 6)
    Transform.getMutable(root).position = Vector3.create(base.x + fwd.x * lean, base.y + Math.sin(t * 1.7) * 0.02, base.z + fwd.z * lean)

    // The head turns toward me when I'm near, and wanders a little when I'm not
    // (and darts about, checking nobody's watching, when he's nervous)
    const me = Transform.getOrNull(engine.PlayerEntity)
    let want = Math.sin(t * 0.3) * 25
    if (me && Vector3.distance(me.position, base) < LOOK_RANGE) {
      const toMe = (Math.atan2(me.position.x - base.x, me.position.z - base.z) * 180) / Math.PI
      want = ((toMe - facing + 540) % 360) - 180
    }
    if (glare > 0) {
      glare -= dt // stares you down: eyes on you, whatever else is going on
    } else if (nervous > 0) {
      nervous -= dt
      want = Math.sin(t * 5) > 0 ? MAX_TURN : -MAX_TURN
    }
    want = Math.max(-MAX_TURN, Math.min(MAX_TURN, want))
    headYaw += (want - headYaw) * Math.min(1, dt * (nervous > 0 || glare > 0 ? 9 : 4))
    Transform.getMutable(head).rotation = Quaternion.fromEulerDegrees(0, headYaw, 0)

    blink -= dt
    const shut = blink < 0.12
    if (blink < 0) blink = 2.5 + Math.random() * 3
    // Narrowed when he's shifty; narrowed and tilted, inner ends down, for a dirty look
    const y = shut ? 0.005 : glare > 0 ? 0.02 : nervous > 0 ? 0.016 : 0.035
    for (const e of eyes) {
      if (Transform.get(e).scale.y !== y) Transform.getMutable(e).scale = Vector3.create(0.06, y, 0.01)
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
      Transform.getMutable(shaker).position = Vector3.add(HAND, Vector3.create(0, Math.sin(t * 40) * 0.06, 0))
      if (shaking <= 0) {
        Transform.getMutable(shaker).position = HAND
        holdGlass(pending.glass as string)
        say(pending.served)
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
        beat.then?.()
      }
    }

    // Now and then, to anyone close enough to hear
    mutter -= dt
    if (mutter <= 0) {
      mutter = 40 + Math.random() * 40
      if (me && Vector3.distance(me.position, base) < MUTTER_NEAR && !bubble.speaking() && !script.length && Math.random() < 0.6) {
        say(pick(MUTTERS))
        nervous = 1.2
      }
    }

    // Walk away and the menu goes back behind the bar
    if (barMenu.open && me && Vector3.distance(me.position, base) > LOOK_RANGE) barMenu.open = false
  })
}

