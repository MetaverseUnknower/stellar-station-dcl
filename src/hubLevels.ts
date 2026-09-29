// The hub's upper levels: the lifts between the hub floor, the two ring balconies and the lounge (lift/lifts.ts), and
// the lounge's dance floor. The floors, the balconies' landings at the shafts and the lounge's lift wells are in
// station.glb (tools/build_station_models.py: BALCONIES, LOUNGE, LIFT_R, LIFT_PLATFORM_R).
import { engine, Entity, Transform, MeshRenderer, Material } from '@dcl/sdk/ecs'
import { Vector3, Quaternion, Color4, Color3 } from '@dcl/sdk/math'
import { onBeat } from './lounge/beatClock'
import { loungeFade } from './lounge/music'
import { CENTER, FLOOR_Y } from './station'
import { buildLifts, FLOORS } from './lift/lifts'

export function buildHubLevels(): void {
  buildLifts()
  buildDanceFloor()
}

// Dance floor: a ring of tiles round the lounge's central opening, cycling colours in waves.
const DANCE_INNER = 7
const DANCE_OUTER = 13
const TILE = 1.4
const PALETTE = [
  Color3.create(1, 0.1, 0.7),
  Color3.create(0.5, 0.1, 1),
  Color3.create(0, 0.6, 1),
  Color3.create(0, 1, 0.8),
  Color3.create(1, 0.6, 0.1)
]

function buildDanceFloor(): void {
  const tiles: { entity: Entity; r: number; a: number }[] = []
  const y = FLOOR_Y + FLOORS[FLOORS.length - 1].height + 0.02
  const n = Math.ceil(DANCE_OUTER / TILE)
  for (let i = -n; i <= n; i++) {
    for (let j = -n; j <= n; j++) {
      const x = i * TILE
      const z = j * TILE
      const r = Math.hypot(x, z)
      if (r < DANCE_INNER || r > DANCE_OUTER) continue
      const tile = engine.addEntity()
      Transform.create(tile, {
        position: Vector3.create(CENTER.x + x, y, CENTER.z + z),
        rotation: Quaternion.fromEulerDegrees(90, 0, 0),
        scale: Vector3.create(TILE * 0.92, TILE * 0.92, 1)
      })
      MeshRenderer.setPlane(tile)
      tiles.push({ entity: tile, r, a: Math.atan2(z, x) })
    }
  }

  // On the lounge's beat (lounge/beatClock.ts): each beat steps the pattern and flashes the tiles, which then dim
  // until the next one. Two material writes per tile per beat.
  const paint = (beat: number, glow: number) => {
    // Alternate between rings rippling outward and a spinning pinwheel every 16 beats.
    const pinwheel = Math.floor(beat / 16) % 2 === 1
    for (const t of tiles) {
      const k = pinwheel ? Math.floor(((t.a + Math.PI) / (2 * Math.PI)) * 10) + beat : Math.floor(t.r / TILE) - beat
      const color = PALETTE[((k % PALETTE.length) + PALETTE.length) % PALETTE.length]
      Material.setPbrMaterial(t.entity, { albedoColor: Color4.fromColor3(color, 1), emissiveColor: color, emissiveIntensity: glow })
    }
  }
  let current = 0
  let dimIn = -1
  paint(0, 1.2)
  onBeat((beat) => {
    current = beat
    // Only while the player is up in the lounge: 208 tiles x 2 writes a beat otherwise ran all session, unseen
    if (loungeFade() <= 0) return
    paint(beat, 2.8)
    dimIn = 0.16
  })
  engine.addSystem((dt) => {
    if (dimIn < 0) return
    dimIn -= dt
    if (dimIn < 0) paint(current, 1.1)
  })
}
