// The bar under the SPACE BAR sign: a curved counter along the lounge wall (space_bar.glb, from
// tools/build_space_bar.py) and a row of The Silt's pedestal bar stools in front of it, sittable with the same
// seating as the couches (seating.ts). One colourway (cyan / magenta) for every stool, not The Silt's daily shuffle.
//
// The stool numbers are The Silt's (venue.ts): stools at 0.75 scale, stood up with a -90 degree X turn, 0.55 m out
// from the counter's front edge; the seat is 0.5 m up and 0.3 m toward the bar, the orb 1.15 m up.
import { engine, Transform, GltfContainer, ColliderLayer } from '@dcl/sdk/ecs'
import { Vector3, Quaternion } from '@dcl/sdk/math'
import { addSeat } from '../seating'
import { CENTER, FLOOR_Y } from '../station'

const LOUNGE = 25 // build_station_models.py LOUNGE
const ANGLE = 235 // the bar's middle, degrees from +X toward +Z (the sign is at 230)
const MODEL_ANGLE = 180 // where the model sits unturned (build_space_bar.py builds it on Blender +X)
const HALF = 16 // build_space_bar.py HALF, degrees
const TOP_FRONT = 24.45 // build_space_bar.py TOP_R0: the counter's front edge
const STOOL_OUT = 0.55 // The Silt: stool centres 0.55 m out from the counter edge
const STOOL_SPACING = 1.4 // metres along the bar
const STOOL_SCALE = 0.75
const SEAT_RISE = 0.5
const SEAT_TOWARD_BAR = 0.3
const ORB_RISE = 1.15
const LOOK_RISE = 1.5

export function buildSpaceBar(): void {
  const floorY = FLOOR_Y + LOUNGE
  const bar = engine.addEntity()
  Transform.create(bar, {
    position: Vector3.create(CENTER.x, floorY, CENTER.z),
    // A yaw turns +Z toward +X, which carries scene angle A to A - yaw.
    rotation: Quaternion.fromEulerDegrees(0, MODEL_ANGLE - ANGLE, 0)
  })
  GltfContainer.create(bar, { src: 'assets/models/space_bar.glb', visibleMeshesCollisionMask: ColliderLayer.CL_PHYSICS })

  const r = TOP_FRONT - STOOL_OUT
  const sweep = ((2 * HALF - 4) * Math.PI) / 180 // keep the end stools off the counter's ends
  const count = Math.floor((sweep * r) / STOOL_SPACING) + 1
  const step = STOOL_SPACING / r
  for (let i = 0; i < count; i++) {
    const a = (ANGLE * Math.PI) / 180 + (i - (count - 1) / 2) * step
    const out = Vector3.create(Math.cos(a), 0, Math.sin(a)) // from the hub centre toward the bar
    const x = CENTER.x + out.x * r
    const z = CENTER.z + out.z * r
    const stool = engine.addEntity()
    Transform.create(stool, {
      position: Vector3.create(x, floorY, z),
      scale: Vector3.create(STOOL_SCALE, STOOL_SCALE, STOOL_SCALE),
      rotation: Quaternion.fromEulerDegrees(-90, (Math.atan2(out.x, out.z) * 180) / Math.PI, 0)
    })
    GltfContainer.create(stool, {
      src: 'assets/models/barstools/pedestal_barstool_cyan_magenta.glb',
      visibleMeshesCollisionMask: ColliderLayer.CL_PHYSICS | ColliderLayer.CL_POINTER
    })
    const seatPos = Vector3.create(x + out.x * SEAT_TOWARD_BAR, floorY + SEAT_RISE, z + out.z * SEAT_TOWARD_BAR)
    addSeat({
      seatPos,
      lookAt: Vector3.create(x + out.x * 4, floorY + LOOK_RISE, z + out.z * 4),
      orbPos: Vector3.create(x, floorY + ORB_RISE, z),
      hoverText: 'Sit',
      hitEntity: stool
    })
  }
}
