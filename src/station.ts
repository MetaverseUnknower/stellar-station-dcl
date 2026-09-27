// The station: a central hub (the Daisy Class pod at 2x) with a pod on each diagonal, joined by corridors.
// tools/build_station_models.py bakes the whole layout into one model with the hub centre at its origin and the
// deck at y 0, so it's placed once, unrotated, and the pieces line up however the explorer converts glTF axes.
import { engine, Entity, Transform, GltfContainer, MeshRenderer, MeshCollider, Material, TextShape } from '@dcl/sdk/ecs'
import { Vector3, Quaternion, Color4, Color3 } from '@dcl/sdk/math'
import { movePlayerTo } from '~system/RestrictedActions'
import { getPlayer } from '@dcl/sdk/players'
import { getGateState, onGateChanged, isPreview } from './gate'
import { buildHubLevels } from './hubLevels'
import { buildShipServices } from './shipServices'
import { buildTradingPost } from './trading/tradingPost'
import { buildNoticeBoard } from './board/noticeBoard'
import { buildHallOfRecords } from './records/hallOfRecords'
import { buildLoungeMusic } from './lounge/music'
import { buildGalaxyHologram } from './observation/galaxyHologram'
import { startBeatClock } from './lounge/beatClock'
import { buildClubLights } from './lounge/clubLights'
import { buildCouches } from './lounge/couches'
import { buildSpaceBarSign } from './lounge/spaceBarSign'
import { buildSpaceBar } from './lounge/spaceBar'

export const CENTER = Vector3.create(128, 0, 128)
export const FLOOR_Y = 40 // same deck height as the ship scene, so the skybox frames it the same way

// The four pods sit on the hub's diagonals, POD_DISTANCE out (tools/build_station_models.py). The diagonals are
// the same whichever way the explorer converts the model's axes, so these positions hold either way.
const POD_DISTANCE = 65.2
const SPAWN_IN_FROM_CENTER = 8 // between the pod's projector dais and its door, toward the hub
const POD_DIRECTIONS = [
  [1, 1],
  [-1, 1],
  [-1, -1],
  [1, -1]
]

function podPoint(index: number, distance: number, y: number): Vector3 {
  const [dx, dz] = POD_DIRECTIONS[index]
  const d = distance / Math.SQRT2
  return Vector3.create(CENTER.x + dx * d, y, CENTER.z + dz * d)
}

/** The pod a player spawns in: fixed per wallet, spread evenly across the four (FNV-1a hash of the address). */
export function podForWallet(wallet: string): number {
  let h = 0x811c9dc5
  for (const ch of wallet.toLowerCase()) {
    h ^= ch.charCodeAt(0)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h % POD_DIRECTIONS.length
}

/** A pod's centre on the deck, and the unit direction from the hub out through it. */
export function podCenter(index: number): Vector3 {
  return podPoint(index, POD_DISTANCE, FLOOR_Y)
}
export function podOutward(index: number): Vector3 {
  const [dx, dz] = POD_DIRECTIONS[index]
  return Vector3.create(dx / Math.SQRT2, 0, dz / Math.SQRT2)
}

// Hub desks: a ring round the projector, facing out. Clear of the lift lanes (+-X), the doorways (diagonals) and the
// window alcoves (+-Z) at the wall; 8 m out is as close as they go: the projector dais reaches ~6.5 m.
export const HUB_DESK_RADIUS = 8
export const HUB_DESK_ANGLES = { tradingPost: 90, noticeBoard: 210, hallOfRecords: 330 } // degrees from +X toward +Z

/** A desk on the hub floor at `deg`, its front (sin yaw, cos yaw) facing out toward the wall. */
export function hubDesk(deg: number): { position: Vector3; yaw: number } {
  const a = (deg * Math.PI) / 180
  const out = Vector3.create(Math.cos(a), 0, Math.sin(a))
  return {
    position: Vector3.create(CENTER.x + out.x * HUB_DESK_RADIUS, FLOOR_Y, CENTER.z + out.z * HUB_DESK_RADIUS),
    yaw: (Math.atan2(out.x, out.z) * 180) / Math.PI
  }
}

export function podSpawn(index: number): { position: Vector3; cameraTarget: Vector3 } {
  return {
    position: podPoint(index, POD_DISTANCE - SPAWN_IN_FROM_CENTER, FLOOR_Y),
    cameraTarget: podPoint(index, POD_DISTANCE, FLOOR_Y + 1) // the pod's projector
  }
}

export function buildStation(): void {
  // The skybox sphere is 96 m across. The ship scales it 1.833; here it's stretched to 125 m radius across the
  // 256 m world so the outer pods (reaching ~82 m out) stay inside it, and kept at the ship's height.
  const skybox = engine.addEntity()
  const across = 125 / 48
  Transform.create(skybox, { position: Vector3.create(CENTER.x, 80, CENTER.z), scale: Vector3.create(across, 1.833, across) })
  GltfContainer.create(skybox, { src: 'assets/models/skybox.glb' })

  const station = engine.addEntity()
  Transform.create(station, { position: Vector3.create(CENTER.x, FLOOR_Y, CENTER.z), rotation: Quaternion.Identity() })
  GltfContainer.create(station, { src: 'assets/models/station/station.glb' })

  buildHoldingBox()
  buildHubLevels()
  buildShipServices()
  buildTradingPost()
  buildNoticeBoard()
  buildHallOfRecords()
  buildLoungeMusic()
  buildGalaxyHologram()
  startBeatClock()
  buildClubLights()
  buildCouches()
  buildSpaceBarSign()
  buildSpaceBar()

  // scene.json spawns everyone in the holding box. They're released into their pod once the gate clears them
  // (in preview straight away: nobody there is docked, and a preview sign-in can hang) and sent back to the box if
  // the gate later refuses them, while it hands them back to the ship.
  let released = false
  const release = () => {
    const wallet = getPlayer()?.userId
    const gate = getGateState()
    const cleared = gate.kind === 'aboard' || isPreview()
    if (released || !cleared || !wallet) return
    released = true
    goTo(podSpawn(podForWallet(wallet)))
  }
  onGateChanged((gate) => {
    if (gate.kind === 'refused' && released && !isPreview()) {
      released = false
      goTo(HOLDING)
    }
    release()
  })

  // Retry the release until the wallet is known, and catch anyone who falls through the hull.
  let cooldown = 0
  engine.addSystem((dt) => {
    release()
    cooldown -= dt
    const player = Transform.getOrNull(engine.PlayerEntity)
    if (!player || cooldown > 0 || !released || player.position.y > FLOOR_Y - 15) return
    cooldown = 3
    const wallet = getPlayer()?.userId
    goTo(wallet ? podSpawn(podForWallet(wallet)) : HOLDING)
  })
}

function goTo(spawn: { position: Vector3; cameraTarget: Vector3 }): void {
  void movePlayerTo({ newRelativePosition: spawn.position, cameraTarget: spawn.cameraTarget })
}

// A sealed black room under the hub (the hub's hull bottoms out around y 30), inside the skybox and out of sight
// of the deck. Keep scene.json's spawn point inside it.
const BOX_CENTER = Vector3.create(CENTER.x, 1, CENTER.z)
const BOX_SIZE = Vector3.create(8, 4, 8)
export const HOLDING = {
  position: Vector3.create(BOX_CENTER.x, BOX_CENTER.y + 0.1, BOX_CENTER.z),
  cameraTarget: Vector3.create(BOX_CENTER.x, BOX_CENTER.y + 1.6, BOX_CENTER.z + 4)
}

function buildHoldingBox(): void {
  const t = 0.5 // wall thickness; each wall is a solid slab, so its outer face shows from inside
  const { x: w, y: h, z: d } = BOX_SIZE
  const slabs: [Vector3, Vector3][] = [
    [Vector3.create(0, -t / 2, 0), Vector3.create(w + 2 * t, t, d + 2 * t)], // floor
    [Vector3.create(0, h + t / 2, 0), Vector3.create(w + 2 * t, t, d + 2 * t)], // ceiling
    [Vector3.create(-(w + t) / 2, h / 2, 0), Vector3.create(t, h, d)],
    [Vector3.create((w + t) / 2, h / 2, 0), Vector3.create(t, h, d)],
    [Vector3.create(0, h / 2, -(d + t) / 2), Vector3.create(w + 2 * t, h, t)],
    [Vector3.create(0, h / 2, (d + t) / 2), Vector3.create(w + 2 * t, h, t)]
  ]
  for (const [offset, scale] of slabs) {
    const slab = engine.addEntity()
    Transform.create(slab, { position: Vector3.add(BOX_CENTER, offset), scale })
    MeshRenderer.setBox(slab)
    MeshCollider.setBox(slab)
    Material.setPbrMaterial(slab, { albedoColor: Color4.Black(), metallic: 0, roughness: 1, specularIntensity: 0 })
  }
  // A faint ring on the floor, so the room reads as a space rather than a blank screen.
  const ring: Entity = engine.addEntity()
  Transform.create(ring, {
    position: Vector3.create(BOX_CENTER.x, BOX_CENTER.y + 0.01, BOX_CENTER.z),
    rotation: Quaternion.fromEulerDegrees(90, 0, 0),
    scale: Vector3.create(3, 3, 1)
  })
  MeshRenderer.setPlane(ring)
  Material.setPbrMaterial(ring, {
    albedoColor: Color4.create(0, 0.2, 0.25, 1),
    emissiveColor: Color3.create(0, 0.5, 0.6),
    emissiveIntensity: 0.6
  })
  // A sign on the wall the spawn faces, so the room reads as an arrivals airlock rather than a scene that didn't load.
  const sign = engine.addEntity()
  Transform.create(sign, {
    // Unrotated text reads from the -z side, where the spawn stands looking toward +z (as the desks' screens do).
    position: Vector3.create(BOX_CENTER.x, BOX_CENTER.y + 2, BOX_CENTER.z + BOX_SIZE.z / 2 - 0.05)
  })
  TextShape.create(sign, {
    text: 'STELLAR STATION\n<size=60%>ARRIVALS AIRLOCK</size>\n\n<size=45%>Checking your docking clearance…</size>',
    fontSize: 5,
    textColor: Color4.create(0, 0.9, 1, 1)
  })
}
