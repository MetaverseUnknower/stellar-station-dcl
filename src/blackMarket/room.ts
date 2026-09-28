// The black market's back room: a sealed obsidian chamber on the lounge floor against the dome, past the pillar at
// the Space Bar's end, where an unregistered relay talks to the Eld, a Kardashev III civilisation that grants favours
// for MANA (tools/build_black_market.py builds the room, the energy field in its doorway, the relay's pedestal and a
// ring). Here: the relay's core (a glowing sphere and its light) inside three rings that turn like a gyroscope, and
// that quicken and brighten while a petition is in flight; a hologram over it; ELD RELAY over the door; and the relay
// opening the market's panel (market.ts, panelUi.tsx).
//
// Model to scene: the room, field and pedestal are built in place round the hub's centre, so they go at the centre
// unturned; a point the build prints in Blender coordinates (x, y, z) is scene (CENTER.x - x, lounge floor + z,
// CENTER.z - y), and a Blender angle A round the hub is scene angle A + 180.
import {
  engine, Entity, Transform, GltfContainer, ColliderLayer, LightSource, TextShape, Font, MeshRenderer, MeshCollider,
  Material, Billboard, BillboardMode, pointerEventsSystem, InputAction
} from '@dcl/sdk/ecs'
import { Vector3, Quaternion, Color3, Color4 } from '@dcl/sdk/math'
import { CENTER, FLOOR_Y } from '../station'
import { openMarket, closeMarket, market } from './market'

const LOUNGE = 25 // build_station_models.py LOUNGE
const FRONT_R = 22.8 // build_black_market.py R_FRONT: the front wall's hub-side face
const DOOR_MID = 200.61 // scene degrees: the doorway's middle (the build prints DOOR scene angles 198.85 .. 202.37)
const CORE = { x: 24.831, y: 7.71, z: 1.55 } // the build's CORE (Blender)
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
const floorY = () => FLOOR_Y + LOUNGE
const fromBlender = (p: { x: number; y: number; z: number }) => Vector3.create(CENTER.x - p.x, floorY() + p.z, CENTER.z - p.y)
const onRadius = (deg: number, r: number, h: number) => {
  const a = (deg * Math.PI) / 180
  return Vector3.create(CENTER.x + Math.cos(a) * r, floorY() + h, CENTER.z + Math.sin(a) * r)
}
/** Text reads from its -Z side: turn +Z to point out, away from the hub's centre, so it faces the centre. */
const facingCentre = (deg: number) => {
  const a = (deg * Math.PI) / 180
  return Quaternion.fromEulerDegrees(0, (Math.atan2(Math.cos(a), Math.sin(a)) * 180) / Math.PI, 0)
}
const mix = (a: Color3, b: Color3, k: number) => Color3.create(a.r + (b.r - a.r) * k, a.g + (b.g - a.g) * k, a.b + (b.b - a.b) * k)

export function buildBlackMarket(): void {
  const place = (src: string, mask: number) => {
    const e = engine.addEntity()
    Transform.create(e, { position: Vector3.create(CENTER.x, floorY(), CENTER.z) })
    GltfContainer.create(e, { src, visibleMeshesCollisionMask: mask, invisibleMeshesCollisionMask: ColliderLayer.CL_NONE })
    return e
  }
  place('assets/models/black_market_room.glb', ColliderLayer.CL_PHYSICS)
  place('assets/models/black_market_field.glb', ColliderLayer.CL_NONE)
  const pedestal = place('assets/models/black_market_relay.glb', ColliderLayer.CL_PHYSICS | ColliderLayer.CL_POINTER)

  // The core: a glowing sphere with a light in it, and something to click that's bigger than the sphere
  const corePos = fromBlender(CORE)
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

  // The hologram over the relay, and the lettering over the door
  const holo = engine.addEntity()
  Transform.create(holo, { position: Vector3.add(corePos, Vector3.create(0, HOLO_RISE, 0)) })
  TextShape.create(holo, { text: '', fontSize: 1.3, font: Font.F_MONOSPACE, textColor: Color4.create(0.75, 0.6, 1, 0.9) })
  Billboard.create(holo, { billboardMode: BillboardMode.BM_Y })
  const sign = engine.addEntity()
  Transform.create(sign, { position: onRadius(DOOR_MID, FRONT_R - 0.02, 2.72), rotation: facingCentre(DOOR_MID) })
  TextShape.create(sign, { text: 'E L D   R E L A Y', fontSize: 1.1, font: Font.F_MONOSPACE, textColor: Color4.create(0.7, 0.55, 1, 1) })

  const relayFloor = Vector3.create(corePos.x, floorY(), corePos.z)
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
