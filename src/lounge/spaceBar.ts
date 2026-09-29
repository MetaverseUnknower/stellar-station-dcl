// The bar under the SPACE BAR sign: a curved counter along the lounge wall (space_bar.glb, from
// tools/build_space_bar.py) and a row of The Silt's pedestal bar stools in front of it, sittable with the same
// seating as the couches (seating.ts). One colourway (cyan / magenta) for every stool, not The Silt's daily shuffle.
//
// The stool numbers are The Silt's (venue.ts) but for the spacing: stools at 0.75 scale, stood up with a -90 degree X turn, 0.7 m out
// from the counter's front edge; the seat is 0.5 m up and 0.3 m toward the bar, the orb 1.15 m up.
//
// The stools' own meshes only take clicks, not collisions: the seat point is 0.3 m from a stool's middle, under its
// cushion's edge, and the avatar's capsule overlapped the cushion there and was shoved off it, a different way on each
// stool (up to 0.3 m), so you sat off-centre. Instead, a collider for the pole below the seat (you still can't walk
// through a stool) and a small invisible step at the seat point for the avatar to stand on, so it's exactly where the
// sit emotes expect (seating.ts; Decentraland's sittingChair and bar/drinks.ts's sitting ones).
import { engine, Entity, Transform, GltfContainer, ColliderLayer, MeshCollider } from '@dcl/sdk/ecs'
import { Vector3, Quaternion } from '@dcl/sdk/math'
import { addSeat } from '../seating'
import { CENTER, FLOOR_Y } from '../station'

const LOUNGE = 25 // build_station_models.py LOUNGE
const ANGLE = 235 // the bar's middle, degrees from +X toward +Z (the sign is at 230)
const MODEL_ANGLE = 180 // where the model sits unturned (build_space_bar.py builds it on Blender +X)
const HALF = 16 // build_space_bar.py HALF, degrees
const TOP_FRONT = 24.45 // build_space_bar.py TOP_R0: the counter's front edge
const STOOL_OUT = 0.7 // stool centres this far out from the counter edge (The Silt's 0.55 sat you tight against the bar)
const STOOL_SPACING = 1.4 // metres along the bar
const STOOL_SCALE = 0.75
const SEAT_RISE = 0.5
const SEAT_TOWARD_BAR = 0.3
const ORB_RISE = 1.15
const POLE_R = 0.08 // the pole's collider (the model's pole is 0.05 m across the middle at this scale; the base, 0.25)
const POLE_TOP = 0.45 // below the step, so it never meets the avatar standing on it
const STEP = 0.3 // the step under the seat point: this wide, its top at SEAT_RISE
const LOOK_RISE = 1.5

/** Builds the bar and its stools; returns the bar, which the back bar's secret leaves hang off (bar/secretDoor.ts). */
export function buildSpaceBar(): Entity {
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
      visibleMeshesCollisionMask: ColliderLayer.CL_POINTER
    })
    const pole = engine.addEntity()
    Transform.create(pole, { position: Vector3.create(x, floorY + POLE_TOP / 2, z), scale: Vector3.create(POLE_R * 2, POLE_TOP, POLE_R * 2) })
    MeshCollider.setCylinder(pole, 0.5, 0.5, ColliderLayer.CL_PHYSICS)
    const seatPos = Vector3.create(x + out.x * SEAT_TOWARD_BAR, floorY + SEAT_RISE, z + out.z * SEAT_TOWARD_BAR)
    const standOn = engine.addEntity()
    Transform.create(standOn, {
      position: Vector3.create(seatPos.x, floorY + SEAT_RISE - 0.05, seatPos.z),
      scale: Vector3.create(STEP, 0.1, STEP),
      rotation: Quaternion.fromEulerDegrees(0, (Math.atan2(out.x, out.z) * 180) / Math.PI, 0)
    })
    MeshCollider.setBox(standOn, ColliderLayer.CL_PHYSICS)
    addSeat({
      seatPos,
      lookAt: Vector3.create(x + out.x * 4, floorY + LOOK_RISE, z + out.z * 4),
      orbPos: Vector3.create(x, floorY + ORB_RISE, z),
      hoverText: 'Sit',
      hitEntity: stool
    })
  }
  return bar
}
