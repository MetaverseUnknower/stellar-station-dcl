// Galaxy Gardeners — Fuel dispenser: the vending machines, and the capsule one pops out on a successful claim.
// From galaxy-gardeners-landing's src/vending.ts: the machine, its panel and the capsule effect are that build's; only
// the placement and size are the station's. There, one machine stood in the terminal building; here it stands in the
// hub's desk ring, opposite the trading post, at 1.5x: at its own 1.7 m it looked toy-sized against the 2x hub.
import { engine, Transform, GltfContainer, ColliderLayer, pointerEventsSystem, InputAction } from '@dcl/sdk/ecs'
import { Vector3, Quaternion } from '@dcl/sdk/math'
import { VENDING_MODEL, CAPSULE_MODEL } from './config'
import { openFuelPanel, setDispenseEffect } from './fuelPanel'
import { hubDesk } from '../station'

// Both models are Z-up exports: -90° about X stands them upright, and the machine's front then faces +Z (north)
const UPRIGHT_X = -90
const MACHINE_SCALE = 1.5   // the model is 1.7 m tall; the tray, capsule and its rise scale with it
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

// Where the machine stands: the hub's desk ring (station.ts), at 270° (the -Z window alcove), opposite the trading
// post at 90°, clear of the lift lanes and doorways. Facing out like the desks.
const HUB_ANGLE = 270

type Placement = { position: Vector3; yaw: number }
let lastUsed: Placement | null = null

function placements(): Placement[] {
  return [hubDesk(HUB_ANGLE)]
}

export function createVendingMachines(): void {
  for (const place of placements()) {
    const machine = engine.addEntity()
    Transform.create(machine, {
      position: place.position,
      // Stand it up, then turn it (the turn applied last, about the vertical).
      rotation: Quaternion.multiply(Quaternion.fromEulerDegrees(0, place.yaw, 0), Quaternion.fromEulerDegrees(UPRIGHT_X, 0, 0)),
      scale: Vector3.create(MACHINE_SCALE, MACHINE_SCALE, MACHINE_SCALE)
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
  const yawed = Vector3.rotate(Vector3.scale(TRAY_OFFSET, MACHINE_SCALE), Quaternion.fromEulerDegrees(0, place.yaw, 0))
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
    let scale = CAPSULE_SCALE * MACHINE_SCALE * Math.min(t / GROW, 1)
    if (t > RISE_TIME + HOLD) {
      scale = CAPSULE_SCALE * MACHINE_SCALE * Math.max(1 - (t - RISE_TIME - HOLD) / SHRINK, 0)
    }
    tf.position = Vector3.create(start.x, start.y + RISE_HEIGHT * MACHINE_SCALE * eased, start.z)
    tf.scale = Vector3.create(scale, scale, scale)
    tf.rotation = Quaternion.fromEulerDegrees(UPRIGHT_X, (t * SPIN_DEG_PER_SEC) % 360, 0)
    if (t >= total) {
      engine.removeSystem(capsuleSystem)
      engine.removeEntity(capsule)
    }
  }
  engine.addSystem(capsuleSystem)
}
