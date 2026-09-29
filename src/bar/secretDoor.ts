// The way to the Eld: the Space Bar's back bar has a centre bay of two leaves (build_space_bar.py LeafL_/LeafR_)
// that swing open, hinged at their outer front corners, onto the doorway of a hidden pod (build_station_models.py
// ELD_*). Ordering the Vacuum on the Rocks, hold the rocks (drinks.ts) buys one way in: BETA opens the leaves, they
// close behind you once you're through, open again when you come back to them from inside, and close behind you once
// you're out. To go back in, order another. Only for you: nobody else sees them move. Anyone already through when the
// scene reloads is inside, so the leaves still let them out.
//
//   closed ─(order)→ invited ─(through the doorway)→ inside ─(back at the doorway)→ leaving ─(clear of the bay)→ closed
//   invited ─(wandered off)→ closed           leaving ─(back into the corridor)→ inside
//   inside ─(gone some other way: a teleport, say)→ closed
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
const WANDERED = 10 // metres from the bay: invited, but gone elsewhere
const BEHIND_R = 27.1 // further out than this, near the doorway's line, you're behind the back bar
const THROUGH_R = 29.6 // in the corridor, past the doorway (the hull is ~28.5 out) and clear of the leaves' swing
const EXIT_R = 31 // coming back along the corridor, this close to the doorway: let them out
const CLEAR = 3 // metres from the bay once out: clear of the leaves' swing (their free ends reach ~2.7 m), so they can close

export type DoorState = 'closed' | 'invited' | 'inside' | 'leaving'

let state: DoorState = 'closed'
let open = false
let leaves: { e: Entity; openYaw: number }[] = []
const listeners: ((from: DoorState, to: DoorState) => void)[] = []

export const doorState = () => state
/** Called on every change of state (BETA has something to say about most of them). */
export function onDoorChanged(fn: (from: DoorState, to: DoorState) => void): void {
  listeners.push(fn)
}

function become(next: DoorState): void {
  if (next === state) return
  const from = state
  state = next
  swing(next === 'invited' || next === 'leaving')
  for (const fn of listeners) fn(from, next)
}

const bayCentre = () => {
  const a = (BAR_ANGLE * Math.PI) / 180
  return Vector3.create(CENTER.x + Math.cos(a) * 26.9, FLOOR_Y + LOUNGE, CENTER.z + Math.sin(a) * 26.9)
}

/** Where I am round the hub: how far out from its centre, how far round from the bar's middle, how far up from the lounge. */
function polar(p: Vector3): { r: number; off: number; up: number } {
  const dx = p.x - CENTER.x
  const dz = p.z - CENTER.z
  let deg = (Math.atan2(dz, dx) * 180) / Math.PI
  if (deg < 0) deg += 360
  return { r: Math.sqrt(dx * dx + dz * dz), off: Math.abs(deg - BAR_ANGLE), up: Math.abs(p.y - (FLOOR_Y + LOUNGE)) }
}

/** How far out from the hub's centre I am if I'm behind the back bar (in the doorway, corridor or pod), or null. */
function behindAt(p: Vector3): number | null {
  const { r, off, up } = polar(p)
  return r > BEHIND_R && off < 12 && up < 6 ? r : null
}

/** Nowhere near the Eld's place: gone some other way than back through the bar (a teleport, say, or a reload). */
function farFromTheEld(p: Vector3): boolean {
  const { r, off, up } = polar(p)
  return r < BEHIND_R - 3 || off > 30 || up > 10
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

/** Through the back bar: in the corridor or the Eld's pod (the music's theirs there: lounge/music.ts). */
export function inTheEldsPlace(): boolean {
  const me = Transform.getOrNull(engine.PlayerEntity)
  const r = me ? behindAt(me.position) : null
  return r !== null && r > THROUGH_R
}

/** The secret's been asked for: one way in. */
export function unlockBackRoom(): void {
  if (state === 'closed') become('invited')
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
    if (check < 0.2) return
    check = 0
    const me = Transform.getOrNull(engine.PlayerEntity)
    if (!me) return
    const r = behindAt(me.position)
    const fromBay = Vector3.distance(me.position, bayCentre())
    switch (state) {
      case 'closed':
        if (r !== null && r > THROUGH_R) become('inside') // already through (a reload, say)
        else if (r !== null) become('leaving') // somehow in the doorway: let them out
        break
      case 'invited':
        if (r !== null && r > THROUGH_R) become('inside')
        else if (r === null && fromBay > WANDERED) become('closed')
        break
      case 'inside':
        if (r !== null && r < EXIT_R) become('leaving')
        else if (farFromTheEld(me.position)) become('closed') // or the back bar stays shut to every later order
        break
      case 'leaving':
        if (r !== null && r > EXIT_R + 1) become('inside')
        else if (r === null && (fromBay > CLEAR || farFromTheEld(me.position))) become('closed')
        break
    }
  })
}
