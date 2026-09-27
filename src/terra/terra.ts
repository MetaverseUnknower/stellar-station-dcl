// Terra, the Earth room: a small pod off the Recreation Deck (build_station_models.py TERRA_*) dressed as a park on
// Earth (terra.glb, from tools/build_terra.py): sky, hills, a lawn with a pond, trees, flowers and two benches. Here:
// the room placed in its pod, seats on the benches (seating.ts), a warm light for the sun, birdsong and a breeze
// (assets/audio/terra_ambience.mp3, tools/make_terra_ambience.py) that fade in as you walk in, and butterflies.
//
// Model to scene: terra.glb is built in the pod's frame with +X pointing out from the hub, which the explorer turns
// to scene -X (angle 180) unturned; a yaw carries scene angle A to A - yaw. Angles round the pod keep their sense, so
// a point at angle p in the model's frame is at scene angle TERRA_ANGLE + p.
import { engine, Entity, Transform, GltfContainer, LightSource, AudioSource, MeshRenderer, Material, ColliderLayer } from '@dcl/sdk/ecs'
import { Vector3, Quaternion, Color3, Color4 } from '@dcl/sdk/math'
import { addSeat } from '../seating'
import { CENTER, FLOOR_Y } from '../station'

const TERRA_ANGLE = 201 + 180 - 360 // build_station_models.py TERRA_ANGLE, in scene degrees (from +X toward +Z)
const TERRA_DIST = 46.5
const TERRA_Z = 9 // the Recreation Deck
const BENCHES = [{ r: 4.3, deg: 90 }, { r: 4.3, deg: 270 }] // build_terra.py BENCHES: facing the pond
// Bench seats (build_terra.py: slats 0.43-0.47 m up over the lawn, from 0.24 m in front of the bench's line to
// 0.25 m behind), with seating.ts's relation to the seat as on the couches: the player about 0.45 m under the seat
// top, standing on the lawn just in front of it, the orb 0.17 m over the seat.
const SEAT_LATERAL = [-0.4, 0.4]
const SEAT_FORWARD = 0.42 // clear of the bench's collider (it stops 0.02 m behind the bench's line), so the sitter isn't nudged out of the emote
const SEAT_RISE = 0.02 // on the deck, the solid floor under the lawn (a teleport above it would drop the sitter out of the emote)
const ORB_RISE = 0.64
const HEAR_INSIDE = 9.5 // the ambience is full inside the room (it's ~9 m across to the wall)
const HEAR_OUTSIDE = 15 // and silent this far from its centre
const AMBIENCE_VOLUME = 0.7

function centre(): Vector3 {
  const a = (TERRA_ANGLE * Math.PI) / 180
  return Vector3.create(CENTER.x + Math.cos(a) * TERRA_DIST, FLOOR_Y + TERRA_Z, CENTER.z + Math.sin(a) * TERRA_DIST)
}

/** A point in the room: r out from its centre at angle deg round it (0 = away from the hub), h up. */
function at(r: number, deg: number, h = 0): Vector3 {
  const c = centre()
  const a = ((TERRA_ANGLE + deg) * Math.PI) / 180
  return Vector3.create(c.x + Math.cos(a) * r, c.y + h, c.z + Math.sin(a) * r)
}

export function buildTerra(): void {
  const c = centre()
  const room = engine.addEntity()
  Transform.create(room, { position: c, rotation: Quaternion.fromEulerDegrees(0, 180 - TERRA_ANGLE, 0) })
  // Only its *_collider meshes (tree trunks, benches) are solid; nothing visible (rocks, tufts, flowers) catches the
  // player or the pointer, so clicks reach the seat orbs.
  GltfContainer.create(room, {
    src: 'assets/models/terra.glb',
    visibleMeshesCollisionMask: ColliderLayer.CL_NONE,
    invisibleMeshesCollisionMask: ColliderLayer.CL_PHYSICS
  })

  // Benches: two seats each, looking across the pond.
  for (const b of BENCHES) {
    const a = ((TERRA_ANGLE + b.deg) * Math.PI) / 180
    const inward = Vector3.create(-Math.cos(a), 0, -Math.sin(a)) // the way the bench faces: in, toward the pond
    const across = Vector3.create(-inward.z, 0, inward.x)
    const base = at(b.r, b.deg)
    for (const l of SEAT_LATERAL) {
      const seat = Vector3.create(base.x + across.x * l + inward.x * SEAT_FORWARD, c.y + SEAT_RISE, base.z + across.z * l + inward.z * SEAT_FORWARD)
      addSeat({
        seatPos: seat,
        lookAt: Vector3.create(seat.x + inward.x * 4, c.y + 1.2, seat.z + inward.z * 4),
        orbPos: Vector3.create(base.x + across.x * l, c.y + ORB_RISE, base.z + across.z * l),
        hoverText: 'Sit'
      })
    }
  }

  // The sun: a warm light high over the pond.
  const sun = engine.addEntity()
  Transform.create(sun, { position: Vector3.create(c.x, c.y + 8, c.z) })
  LightSource.create(sun, { type: LightSource.Type.Point({}), color: Color3.create(1, 0.93, 0.8), intensity: 9000, range: 12, shadow: false })

  // Birdsong and a breeze, filling the room and fading out through the door.
  const ambience = engine.addEntity()
  Transform.create(ambience, { position: Vector3.create(c.x, c.y + 3, c.z) })
  AudioSource.create(ambience, { audioClipUrl: 'assets/audio/terra_ambience.mp3', loop: true, playing: true, volume: 0, global: true })
  let heard = -1
  engine.addSystem(() => {
    const me = Transform.getOrNull(engine.PlayerEntity)
    if (!me) return
    const d = Vector3.distance(me.position, Vector3.create(c.x, me.position.y, c.z))
    const below = Math.abs(me.position.y - (c.y + 1)) > 4
    const t = below ? 0 : Math.max(0, Math.min(1, (HEAR_OUTSIDE - d) / (HEAR_OUTSIDE - HEAR_INSIDE)))
    const v = Math.round(t * t * AMBIENCE_VOLUME * 50) / 50
    if (v === heard) return
    heard = v
    AudioSource.getMutable(ambience).volume = v
  })

  buildButterflies()
}

// ---- butterflies -------------------------------------------------------------------------------------------------

const WING_COLOURS = [
  Color3.create(1, 0.55, 0.1),
  Color3.create(0.3, 0.6, 1),
  Color3.create(1, 0.9, 0.3),
  Color3.create(0.95, 0.95, 1),
  Color3.create(1, 0.45, 0.75)
]

type Butterfly = { root: Entity; left: Entity; right: Entity; r: number; speed: number; phase: number; height: number }

function buildButterflies(): void {
  const flock: Butterfly[] = WING_COLOURS.map((colour, i) => {
    const root = engine.addEntity()
    Transform.create(root, { position: centre() })
    const body = engine.addEntity()
    Transform.create(body, { parent: root, scale: Vector3.create(0.025, 0.025, 0.12) })
    MeshRenderer.setBox(body)
    Material.setPbrMaterial(body, { albedoColor: Color4.create(0.1, 0.08, 0.06, 1) })
    const wing = (side: number) => {
      const hinge = engine.addEntity()
      Transform.create(hinge, { parent: root })
      const w = engine.addEntity()
      Transform.create(w, { parent: hinge, position: Vector3.create(side * 0.07, 0, 0), scale: Vector3.create(0.13, 0.006, 0.11) })
      MeshRenderer.setBox(w)
      Material.setPbrMaterial(w, { albedoColor: Color4.fromColor3(colour, 1), emissiveColor: colour, emissiveIntensity: 0.3, roughness: 0.7 })
      return hinge
    }
    return { root, left: wing(-1), right: wing(1), r: 2.8 + (i % 3) * 1.6, speed: 0.25 + i * 0.04, phase: i * 1.9, height: 0.9 + (i % 2) * 0.6 }
  })

  let t = 0
  engine.addSystem((dt) => {
    t += dt
    const c = centre()
    for (const b of flock) {
      // A wandering loop round the pond: a circle, wobbling in and out and up and down.
      const a = t * b.speed + b.phase
      const r = b.r + Math.sin(t * 0.7 + b.phase) * 0.9
      const x = c.x + Math.cos(a) * r
      const z = c.z + Math.sin(a) * r
      const y = c.y + b.height + Math.sin(t * 1.3 + b.phase) * 0.35 + Math.abs(Math.sin(t * 9 + b.phase)) * 0.06
      // Facing along the path (the tangent), yaw from +Z toward +X.
      const heading = (Math.atan2(-Math.sin(a), Math.cos(a)) * 180) / Math.PI
      const tr = Transform.getMutable(b.root)
      tr.position = Vector3.create(x, y, z)
      tr.rotation = Quaternion.fromEulerDegrees(0, heading, 0)
      const flap = 15 + 55 * (0.5 + 0.5 * Math.sin(t * 16 + b.phase * 3))
      Transform.getMutable(b.left).rotation = Quaternion.fromEulerDegrees(0, 0, -flap)
      Transform.getMutable(b.right).rotation = Quaternion.fromEulerDegrees(0, 0, flap)
    }
  })
}
