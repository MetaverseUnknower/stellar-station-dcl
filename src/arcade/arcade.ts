// The arcade: a small pod off the Recreation Deck (tools/build_station_models.py ARCADE_*), lined with upright
// cabinets (arcade_cabinet.glb, from tools/build_arcade_cabinet.py). Each has its title on the marquee and an
// attract-mode screen that cycles colours with a blinking INSERT COIN. No games yet: they're for the look, and a
// hover says so.
//
// Model to scene: the explorer turns Blender's (x, y, z) to (-x, z, -y) about the hub's centre, so a Blender angle A
// round the hub is scene angle A + 180, turning the same way.
import {
  engine, Entity, Transform, GltfContainer, ColliderLayer, MeshRenderer, Material, TextShape,
  pointerEventsSystem, InputAction
} from '@dcl/sdk/ecs'
import { Vector3, Quaternion, Color3, Color4 } from '@dcl/sdk/math'
import { CENTER, FLOOR_Y } from '../station'

const ARCADE_ANGLE = 10.5 + 180 // build_station_models.py ARCADE_ANGLE, in scene degrees (from +X toward +Z)
const ARCADE_DIST = 46
const ARCADE_Z = 9 // the Recreation Deck
const CABINET_R = 4.4 // out from the pod's centre (its floor is flat to 5.6 m; the wall is at ~6)
// Round the pod from its outward direction: five along the back wall, one each side of the door (at 180); the
// windows are at +-90.
const CABINET_ANGLES = [-36, -18, 0, 18, 36, 140, -140]
const TITLES = ['PETAL INVADERS', 'COMET RUN', 'ASTRO GARDEN', 'NEBULA PONG', 'STAR DRIFT', 'ORBIT BLASTER', 'VOID RACER']

// The screen recess (build_arcade_cabinet.py: the slope from (y -0.22, z 1.06) to (-0.12, 1.62), bezel opening
// 0.6 x 0.51), in the cabinet's own scene axes (it faces +Z).
const SCREEN_CENTRE = Vector3.create(0, 1.341, 0.176)
const SCREEN_TILT = 10.1 // degrees: the top leans back (toward the cabinet's -Z, once turned to face +Z)
const SCREEN_SIZE = Vector3.create(0.6, 0.51, 1)
const MARQUEE_CENTRE = Vector3.create(0, 1.8, 0.3)
// Planes and text read from -Z unrotated (see stations/draw.ts); the cabinet faces +Z, so they're turned half round,
// after the screen's tilt.
const FACE_FRONT = Quaternion.fromEulerDegrees(0, 180, 0)
const ON_SCREEN = Quaternion.multiply(FACE_FRONT, Quaternion.fromEulerDegrees(SCREEN_TILT, 0, 0))

const SCREEN_COLOURS = [
  Color3.create(1, 0.2, 0.7),
  Color3.create(0.5, 0.2, 1),
  Color3.create(0.1, 0.7, 1),
  Color3.create(0.1, 1, 0.6),
  Color3.create(1, 0.7, 0.1)
]

type Cabinet = { screen: Entity; coin: Entity; phase: number }

export function buildArcade(): void {
  const a0 = (ARCADE_ANGLE * Math.PI) / 180
  const cx = CENTER.x + Math.cos(a0) * ARCADE_DIST
  const cz = CENTER.z + Math.sin(a0) * ARCADE_DIST
  const floorY = FLOOR_Y + ARCADE_Z

  const cabinets: Cabinet[] = CABINET_ANGLES.map((deg, i) => {
    const a = a0 + (deg * Math.PI) / 180
    const x = cx + Math.cos(a) * CABINET_R
    const z = cz + Math.sin(a) * CABINET_R
    const cabinet = engine.addEntity()
    Transform.create(cabinet, {
      position: Vector3.create(x, floorY, z),
      // Face the pod's centre: a yaw turns +Z toward +X.
      rotation: Quaternion.fromEulerDegrees(0, (Math.atan2(cx - x, cz - z) * 180) / Math.PI, 0)
    })
    GltfContainer.create(cabinet, {
      src: 'assets/models/arcade_cabinet.glb',
      visibleMeshesCollisionMask: ColliderLayer.CL_PHYSICS | ColliderLayer.CL_POINTER
    })
    pointerEventsSystem.onPointerDown(
      { entity: cabinet, opts: { button: InputAction.IA_POINTER, hoverText: `${TITLES[i]}: coming soon`, maxDistance: 4 } },
      () => {}
    )

    const screen = engine.addEntity()
    Transform.create(screen, {
      parent: cabinet,
      position: SCREEN_CENTRE,
      rotation: ON_SCREEN,
      scale: SCREEN_SIZE
    })
    MeshRenderer.setPlane(screen)

    const coin = engine.addEntity()
    Transform.create(coin, {
      parent: cabinet,
      position: Vector3.create(SCREEN_CENTRE.x, SCREEN_CENTRE.y - 0.12, SCREEN_CENTRE.z + 0.03), // down the slope, just proud of it
      rotation: ON_SCREEN
    })
    TextShape.create(coin, { text: 'INSERT COIN', fontSize: 0.9, textColor: Color4.White(), outlineWidth: 0.2, outlineColor: Color3.Black() })

    const title = engine.addEntity()
    Transform.create(title, { parent: cabinet, position: MARQUEE_CENTRE, rotation: FACE_FRONT })
    TextShape.create(title, { text: TITLES[i], fontSize: 0.85, textColor: Color4.create(0.15, 0.02, 0.2, 1) })

    return { screen, coin, phase: i * 1.3 }
  })

  // Attract mode: each screen drifts through the palette (a material write every 0.15 s per screen), and INSERT
  // COIN blinks.
  let t = 0
  let tick = 0
  let blinkOn = true
  engine.addSystem((dt) => {
    t += dt
    tick += dt
    if (tick < 0.15) return
    tick = 0
    for (const c of cabinets) {
      const k = (t * 0.6 + c.phase) % SCREEN_COLOURS.length
      const from = SCREEN_COLOURS[Math.floor(k)]
      const to = SCREEN_COLOURS[(Math.floor(k) + 1) % SCREEN_COLOURS.length]
      const f = k - Math.floor(k)
      const colour = Color3.create(from.r + (to.r - from.r) * f, from.g + (to.g - from.g) * f, from.b + (to.b - from.b) * f)
      Material.setPbrMaterial(c.screen, { albedoColor: Color4.create(0, 0, 0, 1), emissiveColor: colour, emissiveIntensity: 1.6, roughness: 0.2 })
    }
    const on = Math.floor(t * 1.5) % 2 === 0
    if (on !== blinkOn) {
      blinkOn = on
      for (const c of cabinets) TextShape.getMutable(c.coin).text = on ? 'INSERT COIN' : ''
    }
  })
}
