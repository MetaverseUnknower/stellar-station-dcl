// Additions to the ship's system map (systemView.ts, copied unchanged) in the pods: the Stellar Station on its own
// orbit (the ship's map doesn't draw stations), and a sign over the map: "Welcome To <station>" / "Located In <star>
// System". The station has no orbit of its own in the data, so it goes just inside the habitable zone, the way the
// ship offsets its asteroid belts from it.
import { engine, Entity, Transform, MeshRenderer, Material, TextShape, Billboard, BillboardMode, MaterialTransparencyMode } from '@dcl/sdk/ecs'
import { Vector3, Color3, Color4 } from '@dcl/sdk/math'
import { orbitalRadius } from './systemView'

const CYAN = Color3.create(0, 0.9, 1)
const ICON = 'assets/icons/space-station-icon-clear.png' // the ship's icon with its black made transparent (the original has no alpha)
const ORBIT_SECONDS = 90 // once round the star
const RING_DOTS = 72

/** Draws the station on the map (children of its root, so they scale and move with it). Returns its animation. */
export function markStation(root: Entity, detail: any): (dt: number) => void {
  const sys = detail?.system || detail || {}
  const planets: any[] = detail?.planets || []
  const maxSlot = planets.length > 0 ? Math.max(...planets.map((p) => p.orbital_slot)) : 1
  const habitableSlot = Math.max(2, Math.min(Math.floor(maxSlot / 2) + 1, 4)) // as systemView.ts works it out
  const r = Math.max(1.2, orbitalRadius(habitableSlot, sys.star_type || null) - 0.9)

  // Its orbit, dotted like the ship's selection rings.
  for (let i = 0; i < RING_DOTS; i++) {
    const a = (2 * Math.PI * i) / RING_DOTS
    const dot = engine.addEntity()
    Transform.create(dot, { parent: root, position: Vector3.create(Math.cos(a) * r, 0, Math.sin(a) * r), scale: Vector3.create(0.025, 0.025, 0.025) })
    MeshRenderer.setSphere(dot)
    Material.setPbrMaterial(dot, { albedoColor: Color4.create(0, 0.6, 0.7, 0.6), emissiveColor: CYAN, emissiveIntensity: 1.2, transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND })
  }

  const station = engine.addEntity()
  Transform.create(station, { parent: root, position: Vector3.create(r, 0, 0) })
  const icon = engine.addEntity()
  Transform.create(icon, { parent: station, scale: Vector3.create(0.45, 0.45, 0.45) })
  MeshRenderer.setPlane(icon)
  Material.setPbrMaterial(icon, {
    texture: Material.Texture.Common({ src: ICON }),
    emissiveTexture: Material.Texture.Common({ src: ICON }),
    albedoColor: Color4.create(0, 0.9, 1, 1),
    emissiveColor: CYAN,
    emissiveIntensity: 2,
    // Blended, as the ship draws its icons (draw.ts icon()): the image's transparent background stays clear.
    transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND
  })
  Billboard.create(icon, { billboardMode: BillboardMode.BM_ALL })
  const glow = engine.addEntity()
  Transform.create(glow, { parent: station, scale: Vector3.create(0.16, 0.16, 0.16) })
  MeshRenderer.setSphere(glow)
  Material.setPbrMaterial(glow, { albedoColor: Color4.create(0.6, 1, 1, 1), emissiveColor: CYAN, emissiveIntensity: 3 })
  const label = engine.addEntity()
  Transform.create(label, { parent: station, position: Vector3.create(0, 0.42, 0) })
  TextShape.create(label, { text: 'STELLAR STATION', fontSize: 2.2, textColor: Color4.create(0, 0.9, 1, 1), outlineWidth: 0.15, outlineColor: Color3.Black() })
  Billboard.create(label, { billboardMode: BillboardMode.BM_Y })

  let angle = 0
  return (dt: number) => {
    angle = (angle + (dt * 2 * Math.PI) / ORBIT_SECONDS) % (2 * Math.PI)
    Transform.getMutable(station).position = Vector3.create(Math.cos(angle) * r, 0, Math.sin(angle) * r)
  }
}

let knownStationName: string | null = null
/** The station's name, once a system map has loaded its details (null until then). */
export const stationName = () => knownStationName

/** The sign over the map; place it with the returned entity. */
export function welcomeSign(detail: any): Entity {
  const sys = detail?.system || detail || {}
  const stationName = detail?.station?.name || 'Stellar Station'
  if (detail?.station?.name) knownStationName = detail.station.name
  const starName = sys.name || 'this'
  const sign = engine.addEntity()
  Transform.create(sign, { position: Vector3.create(0, -100, 0) })
  TextShape.create(sign, {
    text: `Welcome To ${stationName}\n<size=65%>Located In ${starName} System</size>`,
    fontSize: 4.5,
    textColor: Color4.create(0, 0.9, 1, 1),
    outlineWidth: 0.12,
    outlineColor: Color3.Black()
  })
  Billboard.create(sign, { billboardMode: BillboardMode.BM_Y })
  return sign
}
