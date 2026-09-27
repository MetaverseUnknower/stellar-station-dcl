// Club lights for the lounge, on the beat (beatClock.ts): four moving spotlights hung from the ceiling, sweeping the
// dance floor with visible beams and changing colour on the beat; a mirror ball (disco_ball.glb, from
// tools/build_disco_ball.py) turning over the central opening and throwing specks of light that sweep over the dome
// and the floor; and a kinetic chandelier of light tubes round it that ripple and rise and fall with the music.
// The spots are real LightSources, so they light avatars and the floor, not just themselves.
import {
  engine, Entity, Transform, MeshRenderer, Material, MaterialTransparencyMode, LightSource, GltfContainer
} from '@dcl/sdk/ecs'
import { Vector3, Quaternion, Color3, Color4 } from '@dcl/sdk/math'
import { CENTER, FLOOR_Y } from '../station'
import { beatLevel, onBeat, beatCount } from './beatClock'

const LOUNGE = 25 // build_station_models.py LOUNGE
const RIG_HEIGHT = 9.5 // above the lounge floor (the dome is ~12 m up over the dance floor)
const RIG_RADIUS = 9 // over the dance floor ring (7..13 m out)
const SPOTS = 4
const BEAM_LENGTH = 11
const PALETTE = [
  Color3.create(1, 0.1, 0.7),
  Color3.create(0.5, 0.1, 1),
  Color3.create(0, 0.6, 1),
  Color3.create(0, 1, 0.8),
  Color3.create(1, 0.6, 0.1)
]

type Spot = { light: Entity; beam: Entity; phase: number; colour: number }

export function buildClubLights(): void {
  const spots: Spot[] = []
  for (let i = 0; i < SPOTS; i++) {
    const a = (i / SPOTS) * Math.PI * 2 + Math.PI / SPOTS
    const light = engine.addEntity()
    Transform.create(light, {
      position: Vector3.create(CENTER.x + Math.cos(a) * RIG_RADIUS, FLOOR_Y + LOUNGE + RIG_HEIGHT, CENTER.z + Math.sin(a) * RIG_RADIUS),
      rotation: Quaternion.fromEulerDegrees(70, 0, 0)
    })
    LightSource.create(light, {
      type: LightSource.Type.Spot({ innerAngle: 14, outerAngle: 26 }),
      color: PALETTE[i % PALETTE.length],
      intensity: 8000,
      range: 26,
      shadow: false
    })
    // The visible beam: a translucent cone along the light's forward (+Z), narrow at the light.
    const beam = engine.addEntity()
    Transform.create(beam, {
      parent: light,
      position: Vector3.create(0, 0, BEAM_LENGTH / 2),
      rotation: Quaternion.fromEulerDegrees(90, 0, 0),
      scale: Vector3.create(1, BEAM_LENGTH, 1)
    })
    MeshRenderer.setCylinder(beam, 0.12, 2.2)
    spots.push({ light, beam, phase: i * 1.7, colour: i % PALETTE.length })
  }

  // Mirror ball over the central opening: flat, slightly askew mirror tiles, so it sparkles as it turns.
  const ball = engine.addEntity()
  Transform.create(ball, { position: Vector3.create(CENTER.x, FLOOR_Y + LOUNGE + BALL_HEIGHT, CENTER.z) })
  GltfContainer.create(ball, { src: 'assets/models/disco_ball.glb' })
  const specks = buildSpecks()
  const chandelier = buildChandelier()

  onBeat((beat) => {
    // Every other beat, each spot moves on to the next colour.
    if (beat % 2 !== 0) return
    for (const s of spots) {
      s.colour = (s.colour + 1) % PALETTE.length
      const light = LightSource.getMutable(s.light)
      light.color = PALETTE[s.colour]
    }
  })

  let t = 0
  let shown = -1
  engine.addSystem((dt) => {
    t += dt
    const level = beatLevel()
    for (const s of spots) {
      // Sweep: a slow circle, tipping in and out across the dance floor.
      const yaw = ((t * 25 + s.phase * 57) % 360)
      const pitch = 62 + Math.sin(t * 0.9 + s.phase) * 14
      Transform.getMutable(s.light).rotation = Quaternion.fromEulerDegrees(pitch, yaw, 0)
    }
    // Brightness follows the beat; beams re-coloured only when the level moves noticeably (material writes).
    const q = Math.round(level * 10) / 10
    for (const s of spots) LightSource.getMutable(s.light).intensity = 3000 + 12000 * level
    if (q !== shown) {
      shown = q
      for (const s of spots) {
        const c = PALETTE[s.colour]
        Material.setPbrMaterial(s.beam, {
          albedoColor: Color4.create(c.r, c.g, c.b, 0.06 + 0.16 * q),
          emissiveColor: c,
          emissiveIntensity: 0.6 + 2.4 * q,
          transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND,
          castShadows: false
        })
      }
    }
    const spin = (t * BALL_SPIN) % 360
    Transform.getMutable(ball).rotation = Quaternion.fromEulerDegrees(0, spin, 0)
    specks(dt, spin, level)
    chandelier(dt, level)
  })
}

// ---- the mirror ball's specks ----------------------------------------------------------------------------------
const BALL_HEIGHT = 7 // above the lounge floor
const BALL_SPIN = 20 // degrees a second
const SPECKS = 90
const SPECK_SIZE = 0.22
const OCULUS = 6.2 // the lounge's central opening (build_station_models.py OCULUS_R, plus its rail)
// The hub's inner wall radius by height above the deck, measured from the model (the dome narrows to its top).
const DOME: [number, number][] = [[25, 28.8], [28, 26.9], [31, 24.3], [34, 20.8], [36, 17.5], [37, 12.8], [37.8, 0]]

function domeRadius(h: number): number {
  if (h <= DOME[0][0]) return DOME[0][1]
  for (let i = 1; i < DOME.length; i++) {
    const [h1, r1] = DOME[i]
    const [h0, r0] = DOME[i - 1]
    if (h <= h1) return r0 + ((r1 - r0) * (h - h0)) / (h1 - h0)
  }
  return 0
}

/**
 * Specks of light thrown by the ball: fixed directions on the ball, turned with it, each traced out to where it
 * meets the lounge (its floor, or the dome), and drawn there as a small glowing square facing the ball. Those that
 * would fall through the central opening are hidden. Updated 20 times a second.
 */
function buildSpecks(): (dt: number, spinDeg: number, level: number) => void {
  const ballH = LOUNGE + BALL_HEIGHT // above the deck
  const dirs: Vector3[] = []
  // Fibonacci sphere, skipping straight up (the rod) and near-straight down (the opening).
  for (let i = 0; dirs.length < SPECKS && i < SPECKS * 2; i++) {
    const y = 1 - (2 * (i + 0.5)) / (SPECKS * 2)
    const r = Math.sqrt(1 - y * y)
    const a = i * 2.399963
    if (y > 0.92 || y < -0.8) continue
    dirs.push(Vector3.create(Math.cos(a) * r, y, Math.sin(a) * r))
  }
  const specks = dirs.map(() => {
    const e = engine.addEntity()
    Transform.create(e, { position: Vector3.create(CENTER.x, FLOOR_Y + ballH, CENTER.z), scale: Vector3.create(0, 0, 0) })
    MeshRenderer.setPlane(e)
    Material.setPbrMaterial(e, {
      albedoColor: Color4.create(1, 1, 1, 0.8),
      emissiveColor: Color3.create(1, 0.95, 0.9),
      emissiveIntensity: 3,
      transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND,
      castShadows: false
    })
    return e
  })
  let since = 0
  return (dt, spinDeg, level) => {
    since += dt
    if (since < 0.05) return
    since = 0
    const turn = Quaternion.fromEulerDegrees(0, spinDeg, 0)
    const size = SPECK_SIZE * (0.8 + 0.5 * level)
    dirs.forEach((d0, i) => {
      const d = Vector3.rotate(d0, turn)
      const hit = trace(ballH, d)
      const t = Transform.getMutable(specks[i])
      if (!hit) {
        t.scale = Vector3.create(0, 0, 0)
        return
      }
      t.position = Vector3.create(CENTER.x + hit.x, FLOOR_Y + hit.y, CENTER.z + hit.z)
      // Face back toward the ball.
      t.rotation = Quaternion.lookRotation(Vector3.create(-d.x, -d.y, -d.z))
      t.scale = Vector3.create(size, size, size)
    })
  }
}

/** Where a ray from the ball meets the lounge: its floor, or the dome. Relative to the hub centre; y above the deck. */
function trace(fromH: number, d: Vector3): Vector3 | null {
  const step = 0.4
  for (let t = 1; t < 45; t += step) {
    const x = d.x * t
    const z = d.z * t
    const h = fromH + d.y * t
    const r = Math.hypot(x, z)
    if (h <= LOUNGE + 0.03) {
      // The floor: back up to exactly its surface.
      const tf = (LOUNGE + 0.03 - fromH) / d.y
      const fx = d.x * tf
      const fz = d.z * tf
      return Math.hypot(fx, fz) < OCULUS ? null : Vector3.create(fx, LOUNGE + 0.03, fz)
    }
    if (r >= domeRadius(h) - 0.1) return Vector3.create(x, h, z)
  }
  return null
}

// ---- the kinetic chandelier -----------------------------------------------------------------------------------
const RING_RADIUS = 4.2
const RING_TOP = 11 // above the lounge floor at its highest
const RIG_DROP = 2.5 // how far the whole rig comes down over a phrase
const TUBES = 24
const TUBE_LENGTH = 2.2
const TUBE_RIPPLE = 0.9 // how far each tube rises and falls on its own
const PHRASE_SECONDS = (16 * 60) / 124

/** A ring of glowing tubes round the ball: each rises and falls a little out of step with its neighbours, so waves
 *  ripple round it, while the whole rig comes down and goes back up over each 16-beat phrase. */
function buildChandelier(): (dt: number, level: number) => void {
  const ring = engine.addEntity()
  Transform.create(ring, { position: Vector3.create(CENTER.x, FLOOR_Y + LOUNGE + RING_TOP, CENTER.z) })
  const segs = 48
  for (let i = 0; i < segs; i++) {
    const a = (i / segs) * Math.PI * 2
    const seg = engine.addEntity()
    Transform.create(seg, {
      parent: ring,
      position: Vector3.create(Math.cos(a) * RING_RADIUS, 0, Math.sin(a) * RING_RADIUS),
      rotation: Quaternion.fromEulerDegrees(0, (-a * 180) / Math.PI, 0),
      scale: Vector3.create(0.08, 0.08, ((2 * Math.PI * RING_RADIUS) / segs) * 1.05)
    })
    MeshRenderer.setBox(seg)
    Material.setPbrMaterial(seg, { albedoColor: Color4.create(0.1, 0.1, 0.13, 1), emissiveColor: Color3.create(0, 0.9, 1), emissiveIntensity: 0.8, metallic: 0.8, roughness: 0.3 })
  }
  const tubes = Array.from({ length: TUBES }, (_, i) => {
    const a = (i / TUBES) * Math.PI * 2
    const tube = engine.addEntity()
    Transform.create(tube, {
      parent: ring,
      position: Vector3.create(Math.cos(a) * RING_RADIUS, -TUBE_LENGTH / 2, Math.sin(a) * RING_RADIUS),
      scale: Vector3.create(0.09, TUBE_LENGTH, 0.09)
    })
    MeshRenderer.setCylinder(tube)
    return tube
  })
  const paint = (beat: number, glow: number) => {
    tubes.forEach((tube, i) => {
      const c = PALETTE[(i + beat) % PALETTE.length]
      Material.setPbrMaterial(tube, { albedoColor: Color4.fromColor3(c, 1), emissiveColor: c, emissiveIntensity: glow })
    })
  }
  paint(0, 1.2)
  let dimIn = -1
  onBeat((beat) => {
    paint(beat, 3)
    dimIn = 0.18
  })
  let t = 0
  let energy = 0 // the beat level, eased: the raw level spikes on every hit, which made the tubes jolt
  return (dt, level) => {
    t += dt
    energy += (level - energy) * Math.min(1, dt * 1.5)
    if (dimIn >= 0) {
      dimIn -= dt
      if (dimIn < 0) paint(beatCount(), 1.2)
    }
    // Down and back up over a 16-beat phrase at 124 BPM (~7.7 s), on its own smooth clock: tying it to the beat
    // count made it jump whenever a beat landed off the clock's count.
    const phrase = (t / PHRASE_SECONDS) % 1
    const drop = RIG_DROP * (0.5 - 0.5 * Math.cos(phrase * Math.PI * 2))
    Transform.getMutable(ring).position = Vector3.create(CENTER.x, FLOOR_Y + LOUNGE + RING_TOP - drop, CENTER.z)
    tubes.forEach((tube, i) => {
      const ripple = TUBE_RIPPLE * (0.5 + 0.5 * Math.sin(t * 1.4 + (i / TUBES) * Math.PI * 4)) * (0.7 + 0.3 * energy)
      Transform.getMutable(tube).position.y = -TUBE_LENGTH / 2 - ripple
    })
  }
}
