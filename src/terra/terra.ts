// Terra, the Earth room: a small pod off the Recreation Deck (build_station_models.py TERRA_*) dressed as a riverside
// on Earth (terra.glb, from tools/build_terra.py): MetaPetal's two Earth views wrapping the room, a lawn, a wide
// river across the far side running off into the views, flowerbeds and two benches on the bank. Here: the room
// placed in its pod, seats on the benches (seating.ts), a grove of trees different at every station (trees.ts), the
// river flowing and the views alive (holo.ts), a warm light for the sun, a pond-side ambience
// (assets/audio/terra_ambience.mp3, tools/make_terra_ambience.py) that fades in as you walk in, and butterflies.
//
// Model to scene: terra.glb is built in the pod's frame with +X pointing out from the hub (toward the river), which
// the explorer turns to scene -X (angle 180) unturned; a yaw carries scene angle A to A - yaw. Angles round the pod
// keep their sense, so a point at angle p in the model's frame is at scene angle TERRA_ANGLE + p.
import {
  engine, Entity, Transform, GltfContainer, LightSource, AudioSource, MeshRenderer, Material, ColliderLayer,
  MaterialTransparencyMode, TextureWrapMode, Tween
} from '@dcl/sdk/ecs'
import { Vector3, Vector2, Quaternion, Color3, Color4 } from '@dcl/sdk/math'
import { addSeat } from '../seating'
import { CENTER, FLOOR_Y } from '../station'
import { onGateChanged, getGateState, GateState } from '../gate'
import { grove, plant, Keepout } from './trees'
import { buildHolo } from './holo'

const TERRA_ANGLE = 201 + 180 - 360 // build_station_models.py TERRA_ANGLE, in scene degrees (from +X toward +Z)
const TERRA_DIST = 46.5
const TERRA_Z = 9 // the Recreation Deck
// build_terra.py's layout, in the room's own frame (x toward the river, away from the door; y across):
const BENCHES = [{ x: 2.6, y: 2.2, facing: 0 }, { x: 2.6, y: -2.2, facing: 0 }] // facing: degrees round the room
const BEDS = [[4.8, 62], [4.9, 150], [4.7, 210], [4.8, 298], [7.4, 100], [7.5, 265]].map(([r, d]) => ({
  x: r * Math.cos((d * Math.PI) / 180),
  y: r * Math.sin((d * Math.PI) / 180)
}))
const RIVER = { x: 7.0, wander: 0.45, freq: 0.33, phase: 0.4, half: 2.7, halfVary: 0.2 } // RIVER_* there
const LAWN_Z = 0.06
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

const riverX = (y: number) => RIVER.x + RIVER.wander * Math.sin(y * RIVER.freq + RIVER.phase)
const riverHalf = (y: number) => RIVER.half + RIVER.halfVary * Math.sin(y * 0.5)

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

/** A point in the room's own frame (x toward the river, y across), h up. */
const place = (x: number, y: number, h = 0) => at(Math.hypot(x, y), (Math.atan2(y, x) * 180) / Math.PI, h)
/** The scene direction of a heading in the room's frame (degrees round from +x). */
function heading(deg: number): Vector3 {
  const a = ((TERRA_ANGLE + deg) * Math.PI) / 180
  return Vector3.create(Math.cos(a), 0, Math.sin(a))
}
/** A yaw turning +Z to a scene direction. */
const yawTo = (d: Vector3) => (Math.atan2(d.x, d.z) * 180) / Math.PI

export function buildTerra(): void {
  const c = centre()
  const room = engine.addEntity()
  Transform.create(room, { position: c, rotation: Quaternion.fromEulerDegrees(0, 180 - TERRA_ANGLE, 0) })
  // Only its *_collider meshes (the benches) are solid; nothing visible (rocks, reeds, flowers) catches the player
  // or the pointer, so clicks reach the seat orbs.
  GltfContainer.create(room, {
    src: 'assets/models/terra.glb',
    visibleMeshesCollisionMask: ColliderLayer.CL_NONE,
    invisibleMeshesCollisionMask: ColliderLayer.CL_PHYSICS
  })

  // Benches on the bank: two seats each, looking across the river.
  for (const b of BENCHES) {
    const forward = heading(b.facing)
    const across = Vector3.create(-forward.z, 0, forward.x)
    const base = place(b.x, b.y)
    for (const l of SEAT_LATERAL) {
      const seat = Vector3.create(base.x + across.x * l + forward.x * SEAT_FORWARD, c.y + SEAT_RISE, base.z + across.z * l + forward.z * SEAT_FORWARD)
      addSeat({
        seatPos: seat,
        lookAt: Vector3.create(seat.x + forward.x * 4, c.y + 1.2, seat.z + forward.z * 4),
        orbPos: Vector3.create(base.x + across.x * l, c.y + ORB_RISE, base.z + across.z * l),
        hoverText: 'Sit'
      })
    }
  }

  buildRiverFlow()
  buildGrove()
  buildHolo({ at, sceneAngle: (deg) => TERRA_ANGLE + deg, centre: c })

  // The sun: a warm light high over the room.
  const sun = engine.addEntity()
  Transform.create(sun, { position: Vector3.create(c.x, c.y + 8, c.z) })
  LightSource.create(sun, { type: LightSource.Type.Point({}), color: Color3.create(1, 0.93, 0.8), intensity: 9000, range: 12, shadow: false })

  // The riverside's sounds, filling the room and fading out through the door.
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

// ---- the river's flow --------------------------------------------------------------------------------------------

const FLOW_LAYERS = [
  { rise: 0.016, metresPerTile: 2.0, speed: 0.25 }, // uv per second along the stream: 0.5 m/s
  { rise: 0.02, metresPerTile: 3.2, speed: 0.13 }
]
const ROOM_EDGE = 9.2 // no further out than this (past it the planes would poke through the hull)

/** Ripples flowing over the river: flat strips along its winding line, their textures scrolling 90 degrees
 *  counter-clockwise (seen from above) from the line's downstream heading, in two layers at different scales and
 *  speeds. */
function buildRiverFlow(): void {
  for (const layer of FLOW_LAYERS) {
    for (let y = 8.4; y > -8.4; y -= 1.4) {
      const ym = y - 0.7
      const near = riverX(ym) - riverHalf(ym)
      const far = Math.min(riverX(ym) + riverHalf(ym), Math.sqrt(Math.max(0, ROOM_EDGE * ROOM_EDGE - ym * ym)))
      const width = far - near
      if (width < 0.5) continue
      const slope = RIVER.wander * RIVER.freq * Math.cos(ym * RIVER.freq + RIVER.phase) // dx/dy
      const down = (Math.atan2(-1, -slope) * 180) / Math.PI // downstream heading in the room's frame
      const e = engine.addEntity()
      Transform.create(e, {
        position: place((near + far) / 2, ym, LAWN_Z + layer.rise),
        // Flat, face up, its length (local +Y after the turn onto its back) running downstream.
        rotation: Quaternion.multiply(Quaternion.fromEulerDegrees(0, yawTo(heading(down)), 0), Quaternion.fromEulerDegrees(90, 0, 0)),
        scale: Vector3.create(width, 1.6, 1)
      })
      // The ripples' texture turned a quarter round, its v running to the strip's left (seen from above): so the
      // flow below runs 90 degrees counter-clockwise from the strip's length, with the ripples' crests across it.
      const w = width / layer.metresPerTile
      const l = 1.6 / layer.metresPerTile
      const face = [0, w, 0, 0, l, 0, l, w] // corners bottom-left, bottom-right, top-right, top-left: (u, v)
      MeshRenderer.setPlane(e, [...face, ...face])
      const tex = Material.Texture.Common({ src: 'assets/images/terra/ripples.png', wrapMode: TextureWrapMode.TWM_REPEAT })
      Material.setPbrMaterial(e, {
        texture: tex,
        emissiveTexture: tex,
        emissiveColor: Color3.create(0.8, 0.92, 1),
        emissiveIntensity: 0.35,
        albedoColor: Color4.create(1, 1, 1, 0.9),
        transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND,
        castShadows: false
      })
      Tween.setTextureMoveContinuous(e, Vector2.create(0, -1), layer.speed) // the ripples run toward the strip's left
    }
  }
}

// ---- the grove ---------------------------------------------------------------------------------------------------

const KEEPOUT: Keepout = {
  inRiver: (x, y, margin) => Math.abs(x - riverX(y)) < riverHalf(y) + margin,
  riverNearEdge: (y) => riverX(y) - riverHalf(y),
  benches: BENCHES.map((b) => ({ x: b.x, y: b.y })),
  beds: BEDS
}

/** This station's trees: planted for the station the player is aboard (a stand-in grove until that's known). */
function buildGrove(): void {
  let trees: Entity[] = []
  let seededFor: string | null = null
  const replant = (id: string) => {
    if (id === seededFor) return
    seededFor = id
    for (const t of trees) engine.removeEntity(t)
    trees = plant(grove(id, KEEPOUT), (x, y) => place(x, y))
  }
  const onGate = (gate: GateState) => replant(gate.kind === 'aboard' ? gate.stationId : 'stellar-station')
  onGateChanged(onGate)
  onGate(getGateState())
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
