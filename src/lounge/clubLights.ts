// Club lights for the lounge, on the beat (beatClock.ts): four moving spotlights hung from the ceiling, sweeping the
// dance floor with visible beams and changing colour on the beat, and a mirror ball turning over the central
// opening. The spots are real LightSources, so they light avatars and the floor, not just themselves.
import {
  engine, Entity, Transform, MeshRenderer, Material, MaterialTransparencyMode, LightSource
} from '@dcl/sdk/ecs'
import { Vector3, Quaternion, Color3, Color4 } from '@dcl/sdk/math'
import { CENTER, FLOOR_Y } from '../station'
import { beatLevel, onBeat } from './beatClock'

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

  // Mirror ball over the central opening, catching the spots.
  const ball = engine.addEntity()
  Transform.create(ball, {
    position: Vector3.create(CENTER.x, FLOOR_Y + LOUNGE + 7, CENTER.z),
    scale: Vector3.create(1.6, 1.6, 1.6)
  })
  MeshRenderer.setSphere(ball)
  Material.setPbrMaterial(ball, { albedoColor: Color4.create(0.85, 0.85, 0.9, 1), metallic: 1, roughness: 0.05 })

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
    Transform.getMutable(ball).rotation = Quaternion.fromEulerDegrees(0, (t * 20) % 360, 0)
  })
}
