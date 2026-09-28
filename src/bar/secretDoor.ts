// The way to the Eld: the Space Bar's back bar has a centre bay of two leaves (build_space_bar.py LeafL_/LeafR_)
// that swing open, hinged at their outer front corners, onto the doorway of a hidden pod (build_station_models.py
// ELD_*). Order the Vacuum on the Rocks, hold the rocks (drinks.ts) and DEX opens them for you: they stay open while
// you're near the bar or through in the pod, and close once you've gone. Only for you: nobody else sees them move.
// Anyone already through when the scene reloads can still get out: the leaves open for someone behind them.
import { engine, Entity, Transform, GltfContainer, ColliderLayer, Tween, EasingFunction } from '@dcl/sdk/ecs'
import { Vector3, Quaternion } from '@dcl/sdk/math'
import { CENTER, FLOOR_Y } from '../station'

const LOUNGE = 25 // build_station_models.py LOUNGE
const BAR_ANGLE = 235 // the bar's middle, and the hidden doorway's (build_station_models.py ELD_ANGLE + 180)
// The hinges, in the bar's own (turned) frame: build_space_bar.py prints them as HINGE, in Blender (x, y, z), which
// is scene (-x, z, -y) here.
const HINGE_X = -26.8379
const HINGE_Z = 1.3126
const SWING = 90 // degrees open
const SWING_MS = 1400
const STAY_NEAR = 10 // metres from the bay: past this (and not through in the pod), the leaves close
const BEHIND_R = 27.1 // further out than this, near the doorway's line, you're behind the back bar

let unlocked = false
let open = false
let leaves: { e: Entity; openYaw: number }[] = []

const bayCentre = () => {
  const a = (BAR_ANGLE * Math.PI) / 180
  return Vector3.create(CENTER.x + Math.cos(a) * 26.9, FLOOR_Y + LOUNGE, CENTER.z + Math.sin(a) * 26.9)
}

/** Behind the back bar: in the doorway, the corridor or the pod beyond (on the lounge's level). */
function behind(p: Vector3): boolean {
  const dx = p.x - CENTER.x
  const dz = p.z - CENTER.z
  const r = Math.sqrt(dx * dx + dz * dz)
  let deg = (Math.atan2(dz, dx) * 180) / Math.PI
  if (deg < 0) deg += 360
  return r > BEHIND_R && Math.abs(deg - BAR_ANGLE) < 12 && Math.abs(p.y - (FLOOR_Y + LOUNGE)) < 6
}

function swing(to: boolean): void {
  if (open === to) return
  open = to
  for (const { e, openYaw } of leaves) {
    const now = Transform.get(e).rotation
    Tween.createOrReplace(e, {
      mode: Tween.Mode.Rotate({ start: now, end: Quaternion.fromEulerDegrees(0, to ? openYaw : 0, 0) }),
      duration: SWING_MS,
      easingFunction: EasingFunction.EF_EASESINE
    })
  }
}

/** The secret's been asked for: open up. */
export function unlockBackRoom(): void {
  unlocked = true
  swing(true)
}

export function buildSecretDoor(bar: Entity): void {
  // A Blender turn of +90 (the left leaf) is a scene yaw of -90, and the other way for the right: both swing their
  // free ends in toward the counter.
  leaves = [
    { src: 'assets/models/space_bar_leafl.glb', z: HINGE_Z, openYaw: -SWING },
    { src: 'assets/models/space_bar_leafr.glb', z: -HINGE_Z, openYaw: SWING }
  ].map(({ src, z, openYaw }) => {
    const e = engine.addEntity()
    Transform.create(e, { parent: bar, position: Vector3.create(HINGE_X, 0, z) })
    GltfContainer.create(e, { src, visibleMeshesCollisionMask: ColliderLayer.CL_PHYSICS })
    return { e, openYaw }
  })

  let check = 0
  engine.addSystem((dt) => {
    check += dt
    if (check < 0.25) return
    check = 0
    const me = Transform.getOrNull(engine.PlayerEntity)
    if (!me) return
    const through = behind(me.position)
    const near = Vector3.distance(me.position, bayCentre()) < STAY_NEAR
    swing(through || (unlocked && near))
  })
}
