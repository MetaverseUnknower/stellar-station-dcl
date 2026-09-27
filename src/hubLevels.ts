// The hub's upper levels: lift pads between the hub floor, two ring balconies and the lounge, and the lounge's
// dance floor. The floors themselves are in station.glb (tools/build_station_models.py: BALCONIES, LOUNGE, LIFT_R).
// Lifts run on both ends of the X axis and the dance floor is a ring round the centre, so, like the rest of the
// layout, none of this depends on which way the explorer converts the model's axes.
import { engine, Entity, Transform, MeshRenderer, Material, TextShape, Billboard, BillboardMode, Tween, EasingFunction } from '@dcl/sdk/ecs'
import { Vector3, Quaternion, Color4, Color3 } from '@dcl/sdk/math'
import { movePlayerTo } from '~system/RestrictedActions'
import { CENTER, FLOOR_Y } from './station'

const LEVELS = [
  { name: 'HUB FLOOR', height: 0 },
  { name: 'BALCONY 1', height: 9 },
  { name: 'BALCONY 2', height: 17 },
  { name: 'LOUNGE', height: 25 }
]
const LIFT_R = 17 // the lift column, in the open atrium (balconies start at 20 m) and through the lounge's wells
const HOVER = 0.3 // lift legs run this far above a floor
const SPEED = 6 // m/s
const PAD_RADIUS = 1
const PAD_SPREAD = 2.3 // up and down pads either side of the arrival point
const UP = Color3.create(0, 0.9, 1)
const DOWN = Color3.create(1, 0.2, 0.8)

/** Where a lift drops you on a level, and where that level's pads sit (off the lift column, clear of rails). */
function arrivalR(level: number): number {
  return level === 0 ? LIFT_R : level === LEVELS.length - 1 ? 21 : 22
}

function point(side: number, r: number, level: number, lateral = 0, above = 0): Vector3 {
  return Vector3.create(CENTER.x + side * r, FLOOR_Y + LEVELS[level].height + above, CENTER.z + lateral)
}

type Pad = { entity: Entity; center: Vector3; path: Vector3[]; color: Color3; inside: boolean; charge: number }

export function buildHubLevels(): void {
  const pads: Pad[] = []
  for (const side of [1, -1]) {
    for (let level = 0; level < LEVELS.length; level++) {
      // The hub floor's up pad sits inside the column; the other levels' pads flank the arrival point.
      if (level < LEVELS.length - 1) {
        const at = level === 0 ? point(side, 13, 0) : point(side, arrivalR(level), level, PAD_SPREAD)
        pads.push(makePad(at, UP, `UP  ·  ${LEVELS[level + 1].name}`, route(side, level, level + 1, at)))
      }
      if (level > 0) {
        const at = point(side, arrivalR(level), level, -PAD_SPREAD)
        pads.push(makePad(at, DOWN, `DOWN  ·  ${LEVELS[level - 1].name}`, route(side, level, level - 1, at)))
      }
    }
  }
  buildDanceFloor()

  let riding = false
  engine.addSystem((dt) => {
    const player = Transform.getOrNull(engine.PlayerEntity)
    if (!player) return
    const pulse = 0.5 + 0.5 * Math.sin(Date.now() / 300)
    for (const pad of pads) {
      const dx = player.position.x - pad.center.x
      const dz = player.position.z - pad.center.z
      const dy = player.position.y - pad.center.y
      const inside = Math.hypot(dx, dz) < PAD_RADIUS && dy > -0.5 && dy < 2
      // Only stepping onto a pad starts it, so arriving next to one (or on one) never sends you straight back.
      if (inside && !pad.inside && !riding) pad.charge = 0.6
      if (!inside) pad.charge = 0
      pad.inside = inside
      if (pad.charge > 0) {
        pad.charge -= dt
        if (pad.charge <= 0 && !riding) {
          riding = true
          ride(pad.path, () => (riding = false))
        }
      }
      const glow = pad.charge > 0 ? 3 : 0.8 + pulse * 0.6
      Material.setPbrMaterial(pad.entity, { albedoColor: Color4.fromColor3(pad.color, 1), emissiveColor: pad.color, emissiveIntensity: glow })
    }
  })
}

/** Out over the atrium (or into the lounge's well), along the lift column, then onto the destination floor. */
function route(side: number, from: number, to: number, start: Vector3): Vector3[] {
  return [
    Vector3.create(start.x, start.y + HOVER, start.z),
    point(side, LIFT_R, from, 0, HOVER),
    point(side, LIFT_R, to, 0, HOVER),
    point(side, arrivalR(to), to, 0, HOVER)
  ]
}

// The lift's platform: a glowing disc that carries the rider, moving with each leg of the ride under their feet
// (movePlayerTo places the feet), and parked out of sight between rides. It's local to each player's scene, so other
// players see the rider glide without it.
const PLATFORM_RADIUS = 1.2
const PLATFORM_THICKNESS = 0.08
// Under the hub (its hull bottoms out near y 30), out of sight. A function, not a constant: this module is loaded
// while station.ts (which imports it) is still starting, before CENTER exists.
const parked = () => Vector3.create(CENTER.x, 20, CENTER.z)
let platform: Entity | null = null

function platformEntity(): Entity {
  if (platform) return platform
  platform = engine.addEntity()
  Transform.create(platform, { position: parked(), scale: Vector3.create(PLATFORM_RADIUS * 2, PLATFORM_THICKNESS, PLATFORM_RADIUS * 2) })
  MeshRenderer.setCylinder(platform)
  Material.setPbrMaterial(platform, { albedoColor: Color4.create(0, 0.6, 0.8, 1), emissiveColor: UP, emissiveIntensity: 1.6, metallic: 0.6, roughness: 0.3 })
  return platform
}

const underFeet = (feet: Vector3) => Vector3.create(feet.x, feet.y - PLATFORM_THICKNESS / 2 - 0.02, feet.z)

function ride(path: Vector3[], done: () => void): void {
  const disc = platformEntity()
  let leg = 0
  let wait = 0
  const system = (dt: number) => {
    wait -= dt
    if (wait > 0) return
    if (leg >= path.length) {
      engine.removeSystem(system)
      // Let the rider step off, then park the platform.
      Tween.deleteFrom(disc)
      Transform.getMutable(disc).position = parked()
      done()
      return
    }
    const from = leg === 0 ? Transform.get(engine.PlayerEntity).position : path[leg - 1]
    const duration = Math.max(0.3, Vector3.distance(from, path[leg]) / SPEED)
    void movePlayerTo({ newRelativePosition: path[leg], duration })
    Tween.setMove(disc, underFeet(from), underFeet(path[leg]), duration * 1000, EasingFunction.EF_LINEAR)
    wait = duration
    leg++
  }
  engine.addSystem(system)
}

function makePad(center: Vector3, color: Color3, label: string, path: Vector3[]): Pad {
  const entity = engine.addEntity()
  Transform.create(entity, {
    position: Vector3.create(center.x, center.y + 0.04, center.z),
    scale: Vector3.create(PAD_RADIUS * 2, 0.06, PAD_RADIUS * 2)
  })
  MeshRenderer.setCylinder(entity)
  const text = engine.addEntity()
  Transform.create(text, { position: Vector3.create(center.x, center.y + 2.4, center.z) })
  TextShape.create(text, { text: label, fontSize: 2.5, textColor: Color4.fromColor3(color, 1), outlineWidth: 0.1, outlineColor: Color3.Black() })
  Billboard.create(text, { billboardMode: BillboardMode.BM_Y })
  return { entity, center, path, color, inside: false, charge: 0 }
}

// Dance floor: a ring of tiles round the lounge's central opening, cycling colours in waves.
const DANCE_INNER = 7
const DANCE_OUTER = 13
const TILE = 1.4
const BEAT = 0.45 // seconds
const PALETTE = [
  Color3.create(1, 0.1, 0.7),
  Color3.create(0.5, 0.1, 1),
  Color3.create(0, 0.6, 1),
  Color3.create(0, 1, 0.8),
  Color3.create(1, 0.6, 0.1)
]

function buildDanceFloor(): void {
  const tiles: { entity: Entity; r: number; a: number }[] = []
  const y = FLOOR_Y + LEVELS[LEVELS.length - 1].height + 0.02
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

  let beat = 0
  let timer = 0
  engine.addSystem((dt) => {
    timer -= dt
    if (timer > 0) return
    timer = BEAT
    beat++
    // Alternate between rings rippling outward and a spinning pinwheel every 16 beats.
    const pinwheel = Math.floor(beat / 16) % 2 === 1
    for (const t of tiles) {
      const k = pinwheel ? Math.floor(((t.a + Math.PI) / (2 * Math.PI)) * 10) + beat : Math.floor(t.r / TILE) - beat
      const color = PALETTE[((k % PALETTE.length) + PALETTE.length) % PALETTE.length]
      Material.setPbrMaterial(t.entity, { albedoColor: Color4.fromColor3(color, 1), emissiveColor: color, emissiveIntensity: 1.6 })
    }
  })
}
