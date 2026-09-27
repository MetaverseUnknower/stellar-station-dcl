// Sittable couches: MetaPetal's dark station sofa (metapetal-dark-sofa-v2-dcl.glb) with rebel-radio's seat layout and
// seating.ts (copied from rebel-radio unchanged). The seat maths in placeCouch is rebel-radio's buildCouch
// (src/lounge.ts).
//
// The model is Y-up at real size: 3.1 m wide, origin on the floor, its front facing -Z (the back cushions are on +Z),
// seat anchors (Seat_1..3_Anchor) 0.838 m apart, 0.549 m up and 0.11 m forward, cushions' front edge 0.46 m forward.
// It carries its own invisible *_collider meshes (seat, back, arms), so its visible meshes only take pointer clicks.
// The seat offsets keep rebel-radio's tested relation to its couch's cushions: the player's position 0.48 m below
// the cushion top and 0.1 m past its front edge, the orb 0.17 m over the cushion.
//
// Where they go: four round the lounge's dance floor, facing it; and in each observation pod (the upper two), a
// pair facing each of its two windows.
import { engine, Transform, GltfContainer, ColliderLayer } from '@dcl/sdk/ecs'
import { Vector3, Quaternion } from '@dcl/sdk/math'
import { addSeat } from '../seating'
import { CENTER, FLOOR_Y } from '../station'

const COUCH_MODEL = 'assets/models/metapetal-dark-sofa-v2-dcl.glb'
const COUCH_HALF_W = 1.56
const COUCH_SEAT_SPACING = 0.838 // the seat anchors
const COUCH_ORB_FORWARD = 0.11 // over the seat anchor
const COUCH_ORB_RISE = 0.72
const COUCH_SEAT_FORWARD = 0.56
const COUCH_SEAT_RISE = 0.07
const COUCH_LOOK_AHEAD = 4.0
const COUCH_LOOK_RISE = 1.5
const COUCH_BODY_CUSHION_INDEX = 1

type CouchSpec = { cx: number; cz: number; yaw: number; floorY: number }

/** rebel-radio's buildCouch: the couch (origin on the floor) and its three seats. Yaw 0 faces +Z. */
function placeCouch(spec: CouchSpec): void {
  const couch = engine.addEntity()
  Transform.create(couch, {
    position: Vector3.create(spec.cx, spec.floorY, spec.cz),
    rotation: Quaternion.fromEulerDegrees(0, spec.yaw + 180, 0) // the model faces -Z
  })
  GltfContainer.create(couch, {
    src: COUCH_MODEL,
    visibleMeshesCollisionMask: ColliderLayer.CL_POINTER,
    invisibleMeshesCollisionMask: ColliderLayer.CL_PHYSICS
  })
  const facing = Vector3.rotate(Vector3.create(0, 0, 1), Quaternion.fromEulerDegrees(0, spec.yaw, 0))
  const across = Vector3.rotate(Vector3.create(1, 0, 0), Quaternion.fromEulerDegrees(0, spec.yaw, 0))
  for (let i = 0; i < 3; i++) {
    const lateral = (i - 1) * COUCH_SEAT_SPACING
    const seatPos = Vector3.create(
      spec.cx + across.x * lateral + facing.x * COUCH_SEAT_FORWARD,
      spec.floorY + COUCH_SEAT_RISE,
      spec.cz + across.z * lateral + facing.z * COUCH_SEAT_FORWARD
    )
    const orbPos = Vector3.create(
      spec.cx + across.x * lateral + facing.x * COUCH_ORB_FORWARD,
      spec.floorY + COUCH_ORB_RISE,
      spec.cz + across.z * lateral + facing.z * COUCH_ORB_FORWARD
    )
    addSeat({
      seatPos,
      lookAt: Vector3.create(seatPos.x + facing.x * COUCH_LOOK_AHEAD, spec.floorY + COUCH_LOOK_RISE, seatPos.z + facing.z * COUCH_LOOK_AHEAD),
      orbPos,
      hoverText: 'Sit',
      hitEntity: i === COUCH_BODY_CUSHION_INDEX ? couch : undefined
    })
  }
}

/** Yaw that faces a couch along (dx, dz); yaw 0 faces +Z and a +yaw turns toward +X. */
const yawFacing = (dx: number, dz: number) => (Math.atan2(dx, dz) * 180) / Math.PI

const LOUNGE = 25 // build_station_models.py LOUNGE
const LOUNGE_COUCH_R = 19 // past the dance floor (7..13 m), clear of the lift wells (17 m out on +-X)
const LOUNGE_COUCH_ANGLES = [45, 135, 225, 315] // degrees from +X toward +Z: off the lift axis
const UPPER = 17 // the upper pods' floor (build_station_models.py UPPER_Z)
const POD_DISTANCE = 65.2
const POD_COUCH_OUT = 9 // from the pod's centre toward its window

export function buildCouches(): void {
  for (const deg of LOUNGE_COUCH_ANGLES) {
    const a = (deg * Math.PI) / 180
    const x = CENTER.x + Math.cos(a) * LOUNGE_COUCH_R
    const z = CENTER.z + Math.sin(a) * LOUNGE_COUCH_R
    placeCouch({ cx: x, cz: z, yaw: yawFacing(CENTER.x - x, CENTER.z - z), floorY: FLOOR_Y + LOUNGE })
  }
  // Observation pods (the upper two, on +-X): a pair of couches facing each window. The kit's window is 90 degrees
  // counter-clockwise (seen from above) from the pod's outward direction, as for every pod (the explorer turns the
  // kit's axes half round; see shipServices.ts); the second window, where the engine was, is opposite it.
  for (const side of [1, -1]) {
    const cx = CENTER.x + side * POD_DISTANCE
    const cz = CENTER.z
    for (const w of [1, -1]) {
      const window = Vector3.create(0, 0, side * w)
      const across = Vector3.create(window.z, 0, -window.x)
      for (const k of [-1, 1]) {
        const lateral = k * (COUCH_HALF_W + 0.3)
        placeCouch({
          cx: cx + window.x * POD_COUCH_OUT + across.x * lateral,
          cz: cz + window.z * POD_COUCH_OUT + across.z * lateral,
          yaw: yawFacing(window.x, window.z),
          floorY: FLOOR_Y + UPPER
        })
      }
    }
  }
}
