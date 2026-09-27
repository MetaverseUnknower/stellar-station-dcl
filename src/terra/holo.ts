// Terra's views, alive: they're a hologram, so they move like the real thing and now and then glitch like a
// projection. Layers laid on the backdrop shell (shell.ts says where each part of the images lies):
//   - falling water streaming down over the waterfalls in both images
//   - thin cloud wisps drifting slowly across the sky
//   - a faint scan line sweeping up the walls every so often
//   - glitches: every few seconds, somewhere, a burst of horizontal slices of the view knocked sideways with a
//     red / cyan split, flickering for a moment; now and then a wider tear
// Textures from tools/build_terra.py (assets/images/terra/).
import {
  engine, Entity, Transform, MeshRenderer, Material, MaterialTransparencyMode, TextureWrapMode, Tween
} from '@dcl/sdk/ecs'
import { Vector3, Vector2, Color3, Color4 } from '@dcl/sdk/math'
import { onWall, wallRotation, viewAt, angleFor, zForV, vForZ, vForImageRow, IMAGE_W } from './shell'

/** Where the room is: a point r out at angle deg round the room (0 = away from the door) and h up, in the scene; and
 *  the scene angle for a room angle. */
export type Room = { at: (r: number, deg: number, h: number) => Vector3; sceneAngle: (deg: number) => number; centre: Vector3 }

const TEX = 'assets/images/terra/'
const VIEWS = [`${TEX}view1.jpg`, `${TEX}view2.jpg`]
const HALF_CIRCUMFERENCE = (r: number) => Math.PI * r // a view spans half the room: u 0..1 over pi r metres

function planeOnWall(room: Room, e: Entity, deg: number, z: number, inset: number, w: number, h: number, parent?: Entity): void {
  const spot = onWall(deg, z, inset)
  let position = room.at(spot.r, deg, spot.z)
  if (parent) position = Vector3.subtract(position, room.centre)
  Transform.createOrReplace(e, {
    position,
    rotation: wallRotation(room.sceneAngle(deg), spot.tilt),
    scale: Vector3.create(w, h, 1),
    parent
  })
}

const uvsFor = (u0: number, v0: number, u1: number, v1: number) => {
  const face = [u0, v0, u1, v0, u1, v1, u0, v1]
  return [...face, ...face]
}

// ---- waterfalls -------------------------------------------------------------------------------------------------

// Each waterfall in the original images: its view, pixel columns and rows (terra-bg-1 has two, terra-bg-2 one).
const FALLS: { view: 0 | 1; x0: number; x1: number; y0: number; y1: number }[] = [
  { view: 0, x0: 1357, x1: 1383, y0: 330, y1: 442 },
  { view: 0, x0: 1456, x1: 1478, y0: 322, y1: 440 },
  { view: 1, x0: 1417, x1: 1438, y0: 370, y1: 466 }
]

function buildFalls(room: Room): void {
  for (const f of FALLS) {
    const u0 = f.x0 / IMAGE_W
    const u1 = f.x1 / IMAGE_W
    const deg = angleFor(f.view, (u0 + u1) / 2)
    const zTop = zForV(vForImageRow(f.y0))
    const zBottom = zForV(vForImageRow(f.y1))
    const spot = onWall(deg, (zTop + zBottom) / 2, 0.06)
    const width = (u1 - u0) * HALF_CIRCUMFERENCE(spot.r)
    const height = zTop - zBottom
    for (const [k, speed, narrow] of [[0, 0.55, 0.9], [1, 0.9, 0.7]] as const) {
      const e = engine.addEntity()
      planeOnWall(room, e, deg, (zTop + zBottom) / 2, 0.06 + k * 0.01, width * narrow, height)
      MeshRenderer.setPlane(e)
      const tex = Material.Texture.Common({ src: `${TEX}water.png`, wrapMode: TextureWrapMode.TWM_REPEAT })
      Material.setPbrMaterial(e, {
        texture: tex,
        emissiveTexture: tex,
        emissiveColor: Color3.create(0.9, 0.95, 1),
        emissiveIntensity: 0.9,
        albedoColor: Color4.create(1, 1, 1, 0.75),
        transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND,
        castShadows: false
      })
      Tween.setTextureMoveContinuous(e, Vector2.create(0, 1), speed) // offset up: the water runs down
    }
  }
}

// ---- cloud wisps -------------------------------------------------------------------------------------------------

const WISP_SEGMENTS = 36
const WISP_BOTTOM = 5.9
const WISP_TOP = 8.7
const WISP_REPEATS = 3 // times the wisps texture goes round the room
const WISP_DRIFT = 1 / 300 // u per second: a full turn of the texture every five minutes

function buildWisps(room: Room): void {
  for (let i = 0; i < WISP_SEGMENTS; i++) {
    const a0 = (360 * i) / WISP_SEGMENTS
    const a1 = (360 * (i + 1)) / WISP_SEGMENTS
    const deg = (a0 + a1) / 2
    // The segment spans the band as a flat chord of the leaning dome, slightly inside it.
    const b = onWall(deg, WISP_BOTTOM, 0.2)
    const t = onWall(deg, WISP_TOP, 0.2)
    const rMid = (b.r + t.r) / 2
    const zMid = (b.z + t.z) / 2
    const chord = Math.hypot(t.r - b.r, t.z - b.z)
    const tilt = (Math.atan2(b.r - t.r, t.z - b.z) * 180) / Math.PI
    const e = engine.addEntity()
    Transform.create(e, {
      position: room.at(rMid, deg, zMid),
      rotation: wallRotation(room.sceneAngle(deg), tilt),
      scale: Vector3.create(2 * rMid * Math.sin(Math.PI / WISP_SEGMENTS) * 1.03, chord, 1)
    })
    // u runs left to right as seen from the room, which is toward smaller angles.
    const uLeft = ((WISP_SEGMENTS - i - 1) / WISP_SEGMENTS) * WISP_REPEATS
    const uRight = ((WISP_SEGMENTS - i) / WISP_SEGMENTS) * WISP_REPEATS
    MeshRenderer.setPlane(e, uvsFor(uLeft, 0, uRight, 1))
    const tex = Material.Texture.Common({ src: `${TEX}wisps.png`, wrapMode: TextureWrapMode.TWM_REPEAT })
    Material.setPbrMaterial(e, {
      texture: tex,
      emissiveTexture: tex,
      emissiveColor: Color3.White(),
      emissiveIntensity: 0.45,
      albedoColor: Color4.create(1, 1, 1, 1),
      transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND,
      castShadows: false
    })
    Tween.setTextureMoveContinuous(e, Vector2.create(1, 0), WISP_DRIFT)
  }
}

// ---- the scan line -----------------------------------------------------------------------------------------------

const SCAN_SEGMENTS = 44
const SCAN_FROM = 0.3
const SCAN_TO = 4.2 // the walls are upright to 4.4 m, so the ring keeps its radius as it rises
const SCAN_SECONDS = 3.5

// ---- glitches ----------------------------------------------------------------------------------------------------

type Layer = { e: Entity; tint: Color4; split: number; inset: number }
const LAYERS: Omit<Layer, 'e'>[] = [
  { tint: Color4.create(1, 1, 1, 1), split: 0, inset: 0.1 },
  { tint: Color4.create(1, 0.25, 0.4, 0.5), split: 0.006, inset: 0.12 },
  { tint: Color4.create(0.25, 1, 1, 0.5), split: -0.006, inset: 0.14 }
]
const SLICES = 4 // at most, per burst

type Slice = { layers: Layer[]; deg: number; z: number; w: number; h: number; view: 0 | 1; u0: number; u1: number; v0: number; v1: number }

function buildGlitches(room: Room): (dt: number) => void {
  const slices: Slice[] = []
  for (let i = 0; i < SLICES; i++) {
    slices.push({
      layers: LAYERS.map((l) => {
        const e = engine.addEntity()
        Transform.create(e, { position: room.centre, scale: Vector3.Zero() })
        return { ...l, e }
      }),
      deg: 0, z: 0, w: 0, h: 0, view: 0, u0: 0, u1: 0, v0: 0, v1: 0
    })
  }
  let wait = 3
  let burst = 0
  let flicker = 0
  let active: Slice[] = []
  let tear = false

  const show = (s: Slice, shift: number, visible: boolean) => {
    for (const l of s.layers) {
      if (!visible) {
        Transform.getMutable(l.e).scale = Vector3.Zero()
        continue
      }
      planeOnWall(room, l.e, s.deg, s.z, l.inset, s.w, s.h)
      const d = shift + l.split
      MeshRenderer.setPlane(l.e, uvsFor(s.u0 + d, s.v0, s.u1 + d, s.v1))
    }
  }

  const start = () => {
    tear = Math.random() < 0.2
    const count = tear ? 3 : 1 + Math.floor(Math.random() * 3)
    active = []
    // Somewhere on the views (not over the doorway), within one image.
    let deg = Math.random() * 360
    if (Math.abs(deg - 180) < 30) deg += 60
    const z = 0.8 + Math.random() * 6.5
    for (let i = 0; i < count; i++) {
      const s = slices[i]
      const w = tear ? 2.4 : 0.8 + Math.random() * 1.8
      const h = tear ? 0.25 + Math.random() * 0.35 : 0.1 + Math.random() * 0.45
      s.deg = tear ? deg + (i - 1) * ((w / (2 * Math.PI * 8.9)) * 360) : deg + (Math.random() - 0.5) * 4
      s.z = tear ? z : z + (Math.random() - 0.5) * 1.6
      s.w = w
      s.h = h
      const spot = onWall(s.deg, s.z, 0.1)
      const { view, u } = viewAt(s.deg)
      const du = w / HALF_CIRCUMFERENCE(spot.r)
      if (u - du / 2 < 0.01 || u + du / 2 > 0.99) continue // across the images' join: skip this slice
      s.view = view
      s.u0 = u - du / 2
      s.u1 = u + du / 2
      s.v0 = vForZ(s.z - h / 2)
      s.v1 = vForZ(s.z + h / 2)
      for (const l of s.layers) {
        const tex = Material.Texture.Common({ src: VIEWS[view] })
        Material.setPbrMaterial(l.e, {
          texture: tex,
          emissiveTexture: tex,
          emissiveColor: Color3.create(l.tint.r, l.tint.g, l.tint.b),
          emissiveIntensity: 0.55,
          albedoColor: l.tint,
          transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND,
          castShadows: false
        })
      }
      active.push(s)
    }
    burst = tear ? 0.35 + Math.random() * 0.3 : 0.12 + Math.random() * 0.35
    flicker = 0
  }

  return (dt: number) => {
    if (burst > 0) {
      burst -= dt
      flicker -= dt
      if (burst <= 0) {
        for (const s of active) show(s, 0, false)
        active = []
        wait = 2.5 + Math.random() * 5
        return
      }
      if (flicker <= 0) {
        flicker = 0.05 + Math.random() * 0.04
        for (const s of active) {
          const shift = (Math.random() < 0.5 ? -1 : 1) * (tear ? 0.03 + Math.random() * 0.05 : 0.005 + Math.random() * 0.025)
          show(s, shift, Math.random() > 0.15)
        }
      }
      return
    }
    wait -= dt
    if (wait <= 0) start()
  }
}

// ---- together ----------------------------------------------------------------------------------------------------

export function buildHolo(room: Room): void {
  buildFalls(room)
  buildWisps(room)
  const glitch = buildGlitches(room)

  // The scan ring rises up the walls every 12-20 s.
  const ring = engine.addEntity()
  Transform.create(ring, { position: room.centre, scale: Vector3.Zero() })
  for (let i = 0; i < SCAN_SEGMENTS; i++) {
    const deg = (360 * (i + 0.5)) / SCAN_SEGMENTS
    if (Math.abs(deg - 180) < 22) continue // the doorway
    const e = engine.addEntity()
    const spot = onWall(deg, 1, 0.25)
    planeOnWall(room, e, deg, 0, 0.25, 2 * spot.r * Math.sin(Math.PI / SCAN_SEGMENTS) * 1.03, 0.3, ring)
    MeshRenderer.setPlane(e)
    const tex = Material.Texture.Common({ src: `${TEX}scan.png` })
    Material.setPbrMaterial(e, {
      texture: tex,
      emissiveTexture: tex,
      emissiveColor: Color3.create(0.6, 1, 0.9),
      emissiveIntensity: 1.4,
      albedoColor: Color4.create(1, 1, 1, 1),
      transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND,
      castShadows: false
    })
  }
  let scanWait = 6
  let scanLeft = -1
  engine.addSystem((dt) => {
    glitch(dt)
    if (scanLeft >= 0) {
      scanLeft -= dt
      if (scanLeft < 0) {
        Transform.getMutable(ring).scale = Vector3.Zero()
        scanWait = 12 + Math.random() * 8
      }
      return
    }
    scanWait -= dt
    if (scanWait <= 0) {
      scanLeft = SCAN_SECONDS
      const from = Vector3.add(room.centre, Vector3.create(0, SCAN_FROM, 0))
      const to = Vector3.add(room.centre, Vector3.create(0, SCAN_TO, 0))
      Transform.getMutable(ring).scale = Vector3.One()
      Tween.setMove(ring, from, to, SCAN_SECONDS * 1000)
    }
  })
}

