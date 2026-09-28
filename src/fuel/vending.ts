// Galaxy Gardeners — Fuel dispenser: the vending machines, and the capsule one pops out on a successful claim.
// From galaxy-gardeners-landing's src/vending.ts: the machine, its panel and the capsule effect are that build's; only
// the placement is the station's. There, one machine stood in the terminal building; here there's one in each
// docking pod, a few metres to the side of the airlock (airlock.ts), facing into the pod: fuel up on the way home.
import { engine, Transform, GltfContainer, ColliderLayer, pointerEventsSystem, InputAction } from '@dcl/sdk/ecs'
import { Vector3, Quaternion } from '@dcl/sdk/math'
import { VENDING_MODEL, CAPSULE_MODEL } from './config'
import { openFuelPanel, setDispenseEffect } from './fuelPanel'
import { podCenter, podOutward, FLOOR_Y } from '../station'

// Both models are Z-up exports: -90° about X stands them upright, and the machine's front then faces +Z (north)
const UPRIGHT_X = -90
// Dispense tray centre in the machine's upright local space (file (-0.06, -0.40, 0.44) -> (x, z, -y))
// The client mirrors GLB contents in local X relative to code-placed entities, so the file's x is negated here
const TRAY_OFFSET = Vector3.create(0.06, 0.44, 0.4)

// Capsule effect timing (seconds) and shape
const CAPSULE_SCALE = 0.3 // ~0.39m tall
const GROW = 0.3
const RISE_TIME = 1.2
const HOLD = 0.6
const SHRINK = 0.4
const RISE_HEIGHT = 0.8
const SPIN_DEG_PER_SEC = 240

// Where the machines stand in the pods: along the hatch's direction, and beside the airlock's ring (its radius 2.2).
const PODS = 4
const ALONG = 12.6 // metres from the pod's centre toward its hatch
const BESIDE = 3.4 // metres to the side (toward the pod's ship desk)

type Placement = { position: Vector3; yaw: number }
let lastUsed: Placement | null = null

function placements(): Placement[] {
  const out: Placement[] = []
  for (let p = 0; p < PODS; p++) {
    const c = podCenter(p)
    const o = podOutward(p)
    const hatch = Vector3.create(o.z, 0, -o.x) // as in airlock.ts / shipServices.ts
    const right = Vector3.create(hatch.z, 0, -hatch.x) // facing the hatch, your right
    const position = Vector3.create(
      c.x + hatch.x * ALONG - right.x * BESIDE,
      FLOOR_Y,
      c.z + hatch.z * ALONG - right.z * BESIDE
    )
    // Facing the pod's centre: its front (+Z once upright) turned toward (c - position).
    const yaw = (Math.atan2(c.x - position.x, c.z - position.z) * 180) / Math.PI
    out.push({ position, yaw })
  }
  return out
}

export function createVendingMachines(): void {
  for (const place of placements()) {
    const machine = engine.addEntity()
    Transform.create(machine, {
      position: place.position,
      // Stand it up, then turn it (the turn applied last, about the vertical).
      rotation: Quaternion.multiply(Quaternion.fromEulerDegrees(0, place.yaw, 0), Quaternion.fromEulerDegrees(UPRIGHT_X, 0, 0))
    })
    GltfContainer.create(machine, {
      src: VENDING_MODEL,
      visibleMeshesCollisionMask: ColliderLayer.CL_PHYSICS | ColliderLayer.CL_POINTER
    })
    pointerEventsSystem.onPointerDown(
      { entity: machine, opts: { button: InputAction.IA_POINTER, hoverText: 'Fuel Cell Dispenser', showHighlight: false } },
      () => {
        lastUsed = place
        void openFuelPanel()
      }
    )
  }
  setDispenseEffect(dispenseCapsule)
}

function trayPosition(place: Placement): Vector3 {
  const yawed = Vector3.rotate(TRAY_OFFSET, Quaternion.fromEulerDegrees(0, place.yaw, 0))
  return Vector3.add(place.position, yawed)
}

/** Capsule grows out of the tray, rises and spins, holds, then shrinks away and is removed */
function dispenseCapsule(): void {
  if (!lastUsed) return
  const start = trayPosition(lastUsed)
  const capsule = engine.addEntity()
  Transform.create(capsule, {
    position: start,
    scale: Vector3.Zero(),
    rotation: Quaternion.fromEulerDegrees(UPRIGHT_X, 0, 0)
  })
  GltfContainer.create(capsule, { src: CAPSULE_MODEL })

  let t = 0
  const total = RISE_TIME + HOLD + SHRINK
  function capsuleSystem(dt: number) {
    t += dt
    const tf = Transform.getMutable(capsule)
    const riseProgress = Math.min(t / RISE_TIME, 1)
    const eased = 1 - Math.pow(1 - riseProgress, 2)
    let scale = CAPSULE_SCALE * Math.min(t / GROW, 1)
    if (t > RISE_TIME + HOLD) {
      scale = CAPSULE_SCALE * Math.max(1 - (t - RISE_TIME - HOLD) / SHRINK, 0)
    }
    tf.position = Vector3.create(start.x, start.y + RISE_HEIGHT * eased, start.z)
    tf.scale = Vector3.create(scale, scale, scale)
    tf.rotation = Quaternion.fromEulerDegrees(UPRIGHT_X, (t * SPIN_DEG_PER_SEC) % 360, 0)
    if (t >= total) {
      engine.removeSystem(capsuleSystem)
      engine.removeEntity(capsule)
    }
  }
  engine.addSystem(capsuleSystem)
}
