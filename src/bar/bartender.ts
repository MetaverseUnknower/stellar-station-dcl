// DEX, the Space Bar's robot bartender (tools/build_bartender.py): he hovers behind the counter beside the back bar's
// centre bay, follows whoever's nearest with his head, blinks, and, clicked, hands over the menu (menuUi.tsx). He
// shakes each drink before it's served into your hand (drinks.ts). The fourth thing on the menu isn't a drink: ask for
// it and he opens the back bar (secretDoor.ts).
import {
  engine, Entity, Transform, GltfContainer, ColliderLayer, MeshRenderer, Material, TextShape, Billboard, BillboardMode,
  pointerEventsSystem, InputAction
} from '@dcl/sdk/ecs'
import { Vector3, Quaternion, Color3, Color4 } from '@dcl/sdk/math'
import { CENTER, FLOOR_Y } from '../station'
import { Drink, holdGlass, startDrinks } from './drinks'
import { unlockBackRoom } from './secretDoor'

const LOUNGE = 25 // build_station_models.py LOUNGE
const ANGLE = 239.4 // scene degrees: behind the counter, 2 m along from the centre bay (clear of its leaves' swing)
const RADIUS = 26.2 // in the aisle between the counter (25.4) and the back bar (26.9)
const NECK = 1.62 // build_bartender.py NECK
const HAND = Vector3.create(0.3, 1.08, 0.36) // build_bartender.py HAND (-0.3, -0.36, 1.08), in scene axes
const LOOK_RANGE = 9
const MAX_TURN = 70 // degrees the head turns either way
const SHAKE_SECONDS = 1.6
const SAY_SECONDS = 4.5

export const barMenu = { open: false }

let say: (text: string) => void = () => {}
let shaking = 0
let pending: Drink | null = null

export function openBarMenu(): void {
  barMenu.open = true
}

export function closeBarMenu(): void {
  barMenu.open = false
}

/** Order from the menu: DEX shakes it (or, for the fourth, doesn't) and serves it. */
export function order(drink: Drink): void {
  barMenu.open = false
  if (drink.glass) {
    say('Coming right up.')
    shaking = SHAKE_SECONDS
    pending = drink
  } else {
    // A long pause for the nothing, then the back bar opens.
    say('…')
    pending = drink
    shaking = -2.2
  }
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

  // What he says, over his head
  const speech = engine.addEntity()
  Transform.create(speech, { parent: root, position: Vector3.create(0, NECK + 0.62, 0) })
  TextShape.create(speech, { text: '', fontSize: 1.4, textColor: Color4.create(1, 0.95, 0.85, 1), outlineWidth: 0.15, outlineColor: Color3.create(0.02, 0.05, 0.12) })
  Billboard.create(speech, { billboardMode: BillboardMode.BM_Y })
  let saying = 0
  say = (text: string) => {
    TextShape.getMutable(speech).text = text
    saying = SAY_SECONDS
  }

  for (const e of [body, head]) {
    pointerEventsSystem.onPointerDown(
      { entity: e, opts: { button: InputAction.IA_POINTER, hoverText: 'Order a drink', maxDistance: 6 } },
      () => {
        say(barMenu.open ? '' : 'What can I get you?')
        openBarMenu()
      }
    )
  }

  let t = 0
  let blink = 3
  let headYaw = 0
  engine.addSystem((dt) => {
    t += dt
    Transform.getMutable(root).position = Vector3.create(base.x, base.y + Math.sin(t * 1.7) * 0.02, base.z)

    // The head turns toward me when I'm near, and wanders a little when I'm not
    const me = Transform.getOrNull(engine.PlayerEntity)
    let want = Math.sin(t * 0.3) * 25
    if (me && Vector3.distance(me.position, base) < LOOK_RANGE) {
      const toMe = (Math.atan2(me.position.x - base.x, me.position.z - base.z) * 180) / Math.PI
      want = ((toMe - facing + 540) % 360) - 180
    }
    want = Math.max(-MAX_TURN, Math.min(MAX_TURN, want))
    headYaw += (want - headYaw) * Math.min(1, dt * 4)
    Transform.getMutable(head).rotation = Quaternion.fromEulerDegrees(0, headYaw, 0)

    blink -= dt
    const shut = blink < 0.12
    if (blink < 0) blink = 2.5 + Math.random() * 3
    for (const e of eyes) {
      const s = Transform.getMutable(e).scale
      const y = shut ? 0.005 : 0.035
      if (s.y !== y) Transform.getMutable(e).scale = Vector3.create(0.06, y, 0.01)
    }

    // Shake the drink, then serve it. (A negative count is the pause before the nothing.)
    if (pending) {
      if (shaking > 0) {
        shaking -= dt
        Transform.getMutable(shaker).position = Vector3.add(HAND, Vector3.create(0, Math.sin(t * 40) * 0.06, 0))
        if (shaking <= 0) {
          Transform.getMutable(shaker).position = HAND
          holdGlass(pending.glass as string)
          say(pending.served)
          pending = null
        }
      } else {
        shaking += dt
        if (shaking >= 0) {
          say(pending.served)
          unlockBackRoom()
          pending = null
        }
      }
    }

    // Walk away and the menu goes back behind the bar
    if (barMenu.open && me && Vector3.distance(me.position, base) > LOOK_RANGE) barMenu.open = false

    if (saying > 0) {
      saying -= dt
      if (saying <= 0) TextShape.getMutable(speech).text = ''
    }
  })
}

