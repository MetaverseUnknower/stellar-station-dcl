// The Eld relay: it stands in the middle of the Eld's pod, the one hidden behind the Space Bar's back bar
// (build_station_models.py ELD_*: obsidian with violet light; bar/secretDoor.ts opens the way). An unregistered relay
// to the Eld, a Kardashev III civilisation that grants favours for MANA (tools/build_black_market.py builds its
// pedestal and a ring): its core, a glowing sphere and its light, inside three rings that turn like a gyroscope and
// quicken and brighten while a petition is in flight; a hologram over it; and it opens the market's panel (market.ts,
// panelUi.tsx).
import {
  engine, Entity, Transform, GltfContainer, ColliderLayer, LightSource, TextShape, Font, MeshRenderer, MeshCollider,
  Material, Billboard, BillboardMode, pointerEventsSystem, InputAction
} from '@dcl/sdk/ecs'
import { Vector3, Quaternion, Color3, Color4 } from '@dcl/sdk/math'
import { CENTER, FLOOR_Y } from '../station'
import { openMarket, closeMarket, market } from './market'

const LOUNGE = 25 // build_station_models.py LOUNGE (the pod's floor is level with the lounge's)
const POD_ANGLE = 55 + 180 // build_station_models.py ELD_ANGLE, in scene degrees (from +X toward +Z)
const POD_DIST = 46 // build_station_models.py ELD_DIST
const CORE_H = 1.55 // build_black_market.py CORE_H
const RINGS = [
  // radius (the ring model is 1 m), a fixed tilt, and turn rates (degrees a second) about X and Y
  { r: 0.3, tilt: 70, rx: 23, ry: 41 },
  { r: 0.38, tilt: 20, rx: -31, ry: 17 },
  { r: 0.46, tilt: 45, rx: 13, ry: -27 }
]
const HOLO_RISE = 0.78 // the hologram, above the core
const WALK_AWAY = 6 // metres from the relay: the panel closes
const VIOLET = Color3.create(0.62, 0.4, 1)
const WHITE_HOT = Color3.create(0.75, 0.9, 1)

// Read at call time: station.ts imports this module, so FLOOR_Y isn't set yet while this file first runs.
const podFloor = () => {
  const a = (POD_ANGLE * Math.PI) / 180
  return Vector3.create(CENTER.x + Math.cos(a) * POD_DIST, FLOOR_Y + LOUNGE, CENTER.z + Math.sin(a) * POD_DIST)
}
const mix = (a: Color3, b: Color3, k: number) => Color3.create(a.r + (b.r - a.r) * k, a.g + (b.g - a.g) * k, a.b + (b.b - a.b) * k)

export function buildRelay(): void {
  const floor = podFloor()
  const pedestal = engine.addEntity()
  Transform.create(pedestal, { position: floor })
  GltfContainer.create(pedestal, {
    src: 'assets/models/black_market_relay.glb',
    visibleMeshesCollisionMask: ColliderLayer.CL_PHYSICS | ColliderLayer.CL_POINTER,
    invisibleMeshesCollisionMask: ColliderLayer.CL_NONE
  })

  // The core: a glowing sphere with a light in it, and something to click that's bigger than the sphere
  const corePos = Vector3.add(floor, Vector3.create(0, CORE_H, 0))
  const core = engine.addEntity()
  Transform.create(core, { position: corePos, scale: Vector3.create(0.26, 0.26, 0.26) })
  MeshRenderer.setSphere(core)
  const touch = engine.addEntity()
  Transform.create(touch, { position: corePos, scale: Vector3.create(1, 1, 1) })
  MeshCollider.setSphere(touch, ColliderLayer.CL_POINTER)
  const light = engine.addEntity()
  Transform.create(light, { position: corePos })
  LightSource.create(light, { type: LightSource.Type.Point({}), color: VIOLET, intensity: 1200, range: 6, shadow: true })

  const rings: Entity[] = RINGS.map((spec) => {
    const e = engine.addEntity()
    Transform.create(e, { position: corePos, scale: Vector3.create(spec.r, spec.r, spec.r) })
    GltfContainer.create(e, {
      src: 'assets/models/black_market_ring.glb',
      visibleMeshesCollisionMask: ColliderLayer.CL_NONE,
      invisibleMeshesCollisionMask: ColliderLayer.CL_NONE
    })
    return e
  })

  for (const e of [pedestal, touch]) {
    pointerEventsSystem.onPointerDown(
      { entity: e, opts: { button: InputAction.IA_POINTER, hoverText: 'Contact the Eld', maxDistance: 4 } },
      () => void openMarket()
    )
  }

  // The hologram over the relay
  const holo = engine.addEntity()
  Transform.create(holo, { position: Vector3.add(corePos, Vector3.create(0, HOLO_RISE, 0)) })
  TextShape.create(holo, { text: '', fontSize: 1.3, font: Font.F_MONOSPACE, textColor: Color4.create(0.75, 0.6, 1, 0.9) })
  Billboard.create(holo, { billboardMode: BillboardMode.BM_Y })

  const relayFloor = floor
  let t = 0
  let spin = 0
  let glowTimer = 0
  let heat = 0 // 0 idle .. 1 transmitting, eased
  engine.addSystem((dt) => {
    t += dt
    const busy = market.open && market.busy
    heat += ((busy ? 1 : 0) - heat) * Math.min(1, dt * 2)
    spin += dt * (1 + heat * 4)

    RINGS.forEach((spec, i) => {
      Transform.getMutable(rings[i]).rotation = Quaternion.fromEulerDegrees(spec.tilt + spin * spec.rx, spin * spec.ry, 0)
    })

    // The core's glow and light breathe; ten times a second is plenty for a material
    glowTimer -= dt
    if (glowTimer <= 0) {
      glowTimer = 0.1
      const breath = 0.5 + 0.5 * Math.sin(t * (1.3 + heat * 5))
      const colour = mix(VIOLET, WHITE_HOT, heat)
      Material.setPbrMaterial(core, {
        albedoColor: Color4.create(colour.r, colour.g, colour.b, 1),
        emissiveColor: colour,
        emissiveIntensity: 2.5 + breath * 2 + heat * 3
      })
      const l = LightSource.getMutable(light)
      l.color = colour
      l.intensity = 900 + breath * 600 + heat * 1500
    }

    const status = !market.open ? 'LISTENING' : busy ? 'TRANSMITTING' : 'IN CONVERSE'
    const dots = '.'.repeat(1 + (Math.floor(t * 2) % 3))
    const text = `THE ELD\n<size=60%>${status}${dots}</size>`
    if (TextShape.get(holo).text !== text) TextShape.getMutable(holo).text = text

    // Walk away and the panel closes
    if (market.open) {
      const me = Transform.getOrNull(engine.PlayerEntity)
      if (me && Vector3.distance(me.position, relayFloor) > WALK_AWAY) closeMarket()
    }
  })
}
