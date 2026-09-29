// Click-to-sit seating — a FAITHFUL PORT of the author's own working
// implementation at ~/-Decentraland/Venues/The Silt/src/venue.ts
// ("Sit spot orbs — 3 per couch", createSitOrb() and the sit system that
// follows it), read directly from that file rather than remembered.
//
// The previous version of this file claimed to be that port and was not.
// It reimplemented the mechanism in this codebase's own idiom, and three
// of those deviations are now the prime suspects for "nothing is clickable
// in the basement". Written out plainly, because the difference is the
// whole point of this rewrite:
//
//  1. CLICK DELIVERY. The Silt creates a raw `PointerEvents` component
//     listing all three event types, then polls
//     `inputSystem.isTriggered(...)` inside its own per-frame system. The
//     old version here used `pointerEventsSystem.onPointerDown` /
//     `onPointerHoverEnter` / `onPointerHoverLeave` callbacks instead —
//     a different SDK surface entirely, not a stylistic variation.
//  2. SEAT HITBOX. The Silt gives every COUCH seat a 0.6 x 0.5 x 0.6
//     invisible CL_POINTER box at the seat position, and that box, not the
//     orb, is what a player realistically hits. The old version here
//     skipped it, and its comment justified doing so by asserting the
//     hitbox was "for its bar stools" — the reverse of what the source
//     does: all twelve couch orbs pass addSeatHitbox true, the bar stools
//     pass nothing. With no hitbox the only target was ORB_SCALE, a THREE
//     CENTIMETRE cube.
//  3. COMPONENT ORDER. In createSitOrb the orb gets `PointerEvents` first
//     and `MeshCollider` second; in the seat hitbox the order is reversed,
//     under the source's own comment "MeshCollider MUST come before
//     PointerEvents". Both orders are reproduced exactly as written there
//     rather than harmonised, because this SDK's sensitivity to it is
//     not something this scene should be discovering again.
//
// Adapted deliberately, and only where this scene requires it:
//   - `registerBlockEntity` on every created entity. The Silt has no
//     hidden interior block; this scene does, and anything inside it that
//     is not registered hangs visible in the sky above the lot. NOTE that
//     this is also the one property every dead interaction in this scene
//     shares. That was investigated with a pair of probe cubes and ruled
//     out: with the mechanism below in place, block-registered targets
//     click fine.
//   - No glass-in-hand system, no SeatState sync across clients, no
//     per-day PRNG layout — none of that is in this scene.
import {
  engine,
  Entity,
  Transform,
  MeshRenderer,
  MeshCollider,
  Material,
  MaterialTransparencyMode,
  PointerEvents,
  PointerEventType,
  InputAction,
  inputSystem,
  ColliderLayer,
  Schemas
} from '@dcl/sdk/ecs'
import { Vector3, Quaternion, Color4 } from '@dcl/sdk/math'
import { movePlayerTo, triggerEmote } from '~system/RestrictedActions'
import { registerBlockEntity } from './descent'

/** The Silt's own module-level seat component, reproduced. */
const SeatState = engine.defineComponent('SeatState', {
  occupied: Schemas.Boolean
})

const ORB_SCALE = 0.03
const ORB_HOVER_SCALE = 0.14
const GROW_SPEED = 0.8
const SIT_EMOTES = ['sittingChair2', 'sittingChair1']
/** The Silt's own walk-away release distance. */
const SIT_RELEASE_DISTANCE = 1.0
// movePlayerTo lands a frame or more later, so until the player has reached the seat the stand-up check must wait (it
// used to run in the same tick as the sit, see the player still where they clicked from, and let the seat go at once:
// seated in the animation, but not as far as the scene knew). Give up on a seat never reached after this long.
const ARRIVE_SECONDS = 3

export type SeatSpec = {
  /** World position the player is moved to on sit. */
  seatPos: Vector3
  /** Where the camera looks once seated (The Silt pins cameraTarget.y to 1.5; this scene's floors are not at y 0, so the caller supplies a full point). */
  lookAt: Vector3
  /** World position of the small marker orb. */
  orbPos: Vector3
  /** hoverText shown on the orb, e.g. "Sit". */
  hoverText?: string
  /**
   * Optional furniture entity (a chair or couch GLB) wired as a second
   * click target for this same seat — The Silt's own `stoolToSitSpot`
   * mapping, which lets clicking the stool itself sit you on it.
   */
  hitEntity?: Entity
  /** The Silt's per-orb resting yaw, which its hover spin adds onto. */
  baseRotY?: number
  /** What sort of seat: a couch's deeper cushion has its own sitting drinking emote (bar/drinks.ts). */
  kind?: 'stool' | 'couch'
}

type SitSpot = {
  orb: Entity
  seatPos: Vector3
  lookAt: Vector3
  emoteIndex: number
  baseRotY: number
  kind: 'stool' | 'couch'
}

const sitSpots: SitSpot[] = []
/** Which seat the local player is in (-1 = none). */
let localSeatIndex = -1
let arrived = false // reached the seat since sitting in it
let sittingFor = 0
/** Whether I'm sitting in one of the scene's seats (bar/drinks.ts: no drinking emote over a sitting one). */
export const isSeated = (): boolean => localSeatIndex >= 0
/** My seat's position and where it looks, while I'm sitting. */
export function seatPlace(): { seatPos: Vector3; lookAt: Vector3; kind: 'stool' | 'couch' } | null {
  const spot = localSeatIndex >= 0 ? sitSpots[localSeatIndex] : undefined
  return spot ? { seatPos: spot.seatPos, lookAt: spot.lookAt, kind: spot.kind } : null
}

const orbTargetScales: Map<Entity, number> = new Map()
const orbHovering: Map<Entity, boolean> = new Map()
const orbSpinProgress: Map<Entity, number> = new Map()
/** The Silt's `stoolToSitSpot`: any extra click target -> the seat it sits you in. */
const furnitureToSitSpot: Map<Entity, number> = new Map()

let systemInstalled = false

export function addSeat(spec: SeatSpec): void {
  const hoverText = spec.hoverText ?? 'Sit'
  const baseRotY = spec.baseRotY ?? 0

  // --- the orb: PointerEvents FIRST, then MeshCollider (createSitOrb's order) ---
  const orb = engine.addEntity()
  Transform.create(orb, {
    position: spec.orbPos,
    scale: Vector3.create(ORB_SCALE, ORB_SCALE, ORB_SCALE),
    // The Silt omits rotation here; this scene's prims.ts rule forbids ever
    // letting a Transform carry `rotation: undefined`, and the system below
    // writes t.rotation every frame, so it gets a real identity to start from.
    rotation: Quaternion.Identity()
  })
  MeshRenderer.setBox(orb)
  Material.setPbrMaterial(orb, {
    albedoColor: Color4.create(0.1, 0.5, 0.8, 0.4),
    emissiveColor: Color4.create(0.2, 0.7, 1.0, 1),
    emissiveIntensity: 4.0,
    metallic: 0,
    roughness: 1,
    transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND
  })
  PointerEvents.create(orb, {
    pointerEvents: [
      {
        eventType: PointerEventType.PET_DOWN,
        eventInfo: {
          button: InputAction.IA_POINTER,
          hoverText,
          maxDistance: 5
        }
      },
      {
        eventType: PointerEventType.PET_HOVER_ENTER,
        eventInfo: { button: InputAction.IA_POINTER, maxDistance: 5, showFeedback: false }
      },
      {
        eventType: PointerEventType.PET_HOVER_LEAVE,
        eventInfo: { button: InputAction.IA_POINTER, maxDistance: 5, showFeedback: false }
      }
    ]
  })
  MeshCollider.setBox(orb, ColliderLayer.CL_POINTER)
  SeatState.create(orb, { occupied: false })
  registerBlockEntity(orb)

  const spotIdx = sitSpots.length
  sitSpots.push({ orb, seatPos: spec.seatPos, lookAt: spec.lookAt, emoteIndex: 0, baseRotY, kind: spec.kind ?? 'stool' })

  // --- the seat hitbox: MeshCollider FIRST, then PointerEvents ---
  // The Silt: "MeshCollider MUST come before PointerEvents". Its couches
  // place this at (seatX, seatY + 0.4, seatZ) at 0.6 x 0.5 x 0.6, i.e. on
  // the ORB's own x/z, 0.4 above the seat. Reproduced.
  const seatHitbox = engine.addEntity()
  Transform.create(seatHitbox, {
    position: Vector3.create(spec.orbPos.x, spec.seatPos.y + 0.4, spec.orbPos.z),
    scale: Vector3.create(0.6, 0.5, 0.6),
    rotation: Quaternion.Identity()
  })
  MeshCollider.setBox(seatHitbox, ColliderLayer.CL_POINTER)
  PointerEvents.create(seatHitbox, {
    pointerEvents: [
      { eventType: PointerEventType.PET_DOWN, eventInfo: { button: InputAction.IA_POINTER, hoverText, maxDistance: 4 } },
      { eventType: PointerEventType.PET_HOVER_ENTER, eventInfo: { button: InputAction.IA_POINTER, maxDistance: 4, showFeedback: false } },
      { eventType: PointerEventType.PET_HOVER_LEAVE, eventInfo: { button: InputAction.IA_POINTER, maxDistance: 4, showFeedback: false } }
    ]
  })
  registerBlockEntity(seatHitbox)
  furnitureToSitSpot.set(seatHitbox, spotIdx)

  // --- the furniture itself, The Silt's makeStoolClickable ---
  if (spec.hitEntity !== undefined) {
    PointerEvents.create(spec.hitEntity, {
      pointerEvents: [
        { eventType: PointerEventType.PET_DOWN, eventInfo: { button: InputAction.IA_POINTER, hoverText, maxDistance: 4 } },
        { eventType: PointerEventType.PET_HOVER_ENTER, eventInfo: { button: InputAction.IA_POINTER, maxDistance: 4, showFeedback: false } },
        { eventType: PointerEventType.PET_HOVER_LEAVE, eventInfo: { button: InputAction.IA_POINTER, maxDistance: 4, showFeedback: false } }
      ]
    })
    furnitureToSitSpot.set(spec.hitEntity, spotIdx)
  }

  if (!systemInstalled) {
    systemInstalled = true
    engine.addSystem(tickSeating)
  }
}

/** Someone else can sit the player down instead (bar/drinks.ts, holding a drink: the sitting drinking emote in place
 *  of the sit, laid out the same). Given the seat's position and where it looks; returns whether it did. */
let sitHook: ((seatPos: Vector3, lookAt: Vector3, kind: 'stool' | 'couch') => boolean) | null = null
export function setSitHook(fn: (seatPos: Vector3, lookAt: Vector3, kind: 'stool' | 'couch') => boolean): void {
  sitHook = fn
}

function sitIn(spotIdx: number): void {
  // Moving seat to seat without standing up: let the one I was in go (it stayed occupied, its orb hidden, for good)
  if (localSeatIndex >= 0 && localSeatIndex !== spotIdx) SeatState.getMutable(sitSpots[localSeatIndex].orb).occupied = false
  const spot = sitSpots[spotIdx]
  const seatState = SeatState.getMutable(spot.orb)
  if (!sitHook?.(spot.seatPos, spot.lookAt, spot.kind)) {
    movePlayerTo({
      newRelativePosition: { x: spot.seatPos.x, y: spot.seatPos.y, z: spot.seatPos.z },
      cameraTarget: { x: spot.lookAt.x, y: spot.lookAt.y, z: spot.lookAt.z }
    })
    triggerEmote({ predefinedEmote: SIT_EMOTES[spot.emoteIndex] })
    spot.emoteIndex = (spot.emoteIndex + 1) % SIT_EMOTES.length
  }
  seatState.occupied = true
  localSeatIndex = spotIdx
  arrived = false
  sittingFor = 0
}

function tickSeating(dt: number) {
  for (let i = 0; i < sitSpots.length; i++) {
    const spot = sitSpots[i]
    const seatState = SeatState.getMutable(spot.orb)

    // Hide orb if occupied (scale to zero)
    if (seatState.occupied && localSeatIndex !== i) {
      const t = Transform.getMutable(spot.orb)
      t.scale = Vector3.create(0, 0, 0)
      continue
    }

    // Track hover state
    if (inputSystem.isTriggered(InputAction.IA_POINTER, PointerEventType.PET_HOVER_ENTER, spot.orb)) {
      orbTargetScales.set(spot.orb, ORB_HOVER_SCALE)
      orbHovering.set(spot.orb, true)
      orbSpinProgress.set(spot.orb, 0)
    }
    if (inputSystem.isTriggered(InputAction.IA_POINTER, PointerEventType.PET_HOVER_LEAVE, spot.orb)) {
      orbTargetScales.set(spot.orb, ORB_SCALE)
      orbHovering.set(spot.orb, false)
    }

    // Gradual scale lerp + spin
    const target = orbTargetScales.get(spot.orb) ?? ORB_SCALE
    const isHovered = orbHovering.get(spot.orb) || false
    const t = Transform.getMutable(spot.orb)
    const current = t.scale.x
    const newScale =
      Math.abs(current - target) > 0.001 ? current + (target - current) * Math.min(1, GROW_SPEED * dt * 10) : target

    // Continuous spin while hovered
    let spinAngle = spot.baseRotY
    if (isHovered) {
      let progress = orbSpinProgress.get(spot.orb) ?? 0
      progress += dt * 0.8
      orbSpinProgress.set(spot.orb, progress)
      spinAngle = spot.baseRotY + progress * 90
    } else {
      orbSpinProgress.set(spot.orb, 0)
    }

    t.scale = Vector3.create(newScale, newScale, newScale)
    t.rotation = Quaternion.fromEulerDegrees(0, spinAngle, 0)

    // Click to sit
    if (inputSystem.isTriggered(InputAction.IA_POINTER, PointerEventType.PET_DOWN, spot.orb)) {
      sitIn(i)
    }
  }

  // Hover on any secondary target (seat hitbox, chair or couch) grows its orb.
  for (const [entity, spotIdx] of furnitureToSitSpot) {
    if (spotIdx >= sitSpots.length) continue
    const spot = sitSpots[spotIdx]
    if (inputSystem.isTriggered(InputAction.IA_POINTER, PointerEventType.PET_HOVER_ENTER, entity)) {
      orbTargetScales.set(spot.orb, ORB_HOVER_SCALE)
      orbHovering.set(spot.orb, true)
      orbSpinProgress.set(spot.orb, 0)
    }
    if (inputSystem.isTriggered(InputAction.IA_POINTER, PointerEventType.PET_HOVER_LEAVE, entity)) {
      orbTargetScales.set(spot.orb, ORB_SCALE)
      orbHovering.set(spot.orb, false)
    }
  }

  // Clicking any secondary target sits you in its linked spot.
  for (const [entity, spotIdx] of furnitureToSitSpot) {
    if (inputSystem.isTriggered(InputAction.IA_POINTER, PointerEventType.PET_DOWN, entity)) {
      if (spotIdx < sitSpots.length) {
        const seatState = SeatState.getMutable(sitSpots[spotIdx].orb)
        if (!seatState.occupied) sitIn(spotIdx)
      }
    }
  }

  // Detect when local player stands up (moves away from seat)
  if (localSeatIndex >= 0) {
    const pt = Transform.getOrNull(engine.PlayerEntity)
    if (pt) {
      const spot = sitSpots[localSeatIndex]
      const dx = pt.position.x - spot.seatPos.x
      const dz = pt.position.z - spot.seatPos.z
      const dist = Math.sqrt(dx * dx + dz * dz)
      sittingFor += dt
      if (!arrived && dist <= SIT_RELEASE_DISTANCE) arrived = true
      if ((arrived && dist > SIT_RELEASE_DISTANCE) || (!arrived && sittingFor > ARRIVE_SECONDS)) {
        const seatState = SeatState.getMutable(spot.orb)
        seatState.occupied = false
        localSeatIndex = -1
      }
    }
  }
}
