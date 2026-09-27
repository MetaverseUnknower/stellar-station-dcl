// The hub's upper levels: two lift shafts between the hub floor, the two ring balconies and the lounge, and the
// lounge's dance floor. The floors, the balconies' landings at the shafts and the lounge's lift wells are in
// station.glb (tools/build_station_models.py: BALCONIES, LOUNGE, LIFT_R, LIFT_PLATFORM_R).
//
// Each lift is a solid platform the rider stands on, moved with a Tween; the explorer carries a standing avatar with
// its platform, so nothing moves the player directly. Stand on it and press E (up) or F (down); from any level,
// click the lift's call button. While the platform is elsewhere, a gate closes each landing so nobody steps into an
// empty shaft. Lifts run on both ends of the X axis, so, like the rest of the layout, none of this depends on which
// way the explorer converts the model's axes.
import {
  engine, Entity, Transform, MeshRenderer, MeshCollider, Material, Tween, EasingFunction,
  PointerEventType, InputAction, inputSystem, pointerEventsSystem, ColliderLayer, Schemas
} from '@dcl/sdk/ecs'
import { Vector3, Quaternion, Color4, Color3 } from '@dcl/sdk/math'
import { syncEntity } from '@dcl/sdk/network'
import { CENTER, FLOOR_Y } from './station'

const LEVELS = [
  { name: 'HUB FLOOR', height: 0 },
  { name: 'OBSERVATION DECK', height: 9 },
  { name: 'BALCONY 2', height: 17 },
  { name: 'LOUNGE', height: 25 }
]
const LIFT_R = 17 // the shaft's centre: in the open atrium (balconies start at 20 m) and through the lounge's wells
const PLATFORM_RADIUS = 1.5 // build_station_models.py LIFT_PLATFORM_R
const PLATFORM_THICKNESS = 0.12
const SPEED = 2.5 // m/s
const DWELL = 0.4 // seconds after arriving before the gate opens
const GLOW = Color3.create(0, 0.9, 1)
const GATE = Color3.create(1, 0.25, 0.8)

// What every player agrees on about a lift, synced between scenes: the level it last settled at, where it's going
// (the same level when idle) and when it set off (ms, the sender's clock; only used by players who join mid-ride).
// Each scene animates its own platform from this, so the platform itself is never synced.
const LiftState = engine.defineComponent('stellar::LiftState', {
  level: Schemas.Int,
  target: Schemas.Int,
  startedAt: Schemas.Int64
})
const LIFT_SYNC_IDS = { 1: 7101, [-1]: 7102 } as Record<number, number>

type Lift = {
  side: number
  platform: Entity
  state: Entity // synced LiftState
  gates: (Entity | null)[] // per level; none on the hub floor
  level: number // settled level, as this scene shows it
  moving: boolean
  seen: { target: number; startedAt: number } | null // the last LiftState this scene acted on
}

const lifts: Lift[] = []

/** The platform's centre when its top is flush with a level's floor. */
function platformAt(side: number, level: number): Vector3 {
  return Vector3.create(CENTER.x + side * LIFT_R, FLOOR_Y + LEVELS[level].height + 0.01 - PLATFORM_THICKNESS / 2, CENTER.z)
}

/** The lift the player is standing on, if any. */
export function liftUnderPlayer(): { level: string; canUp: boolean; canDown: boolean; moving: boolean } | null {
  const player = Transform.getOrNull(engine.PlayerEntity)
  if (!player) return null
  for (const lift of lifts) {
    const p = Transform.get(lift.platform).position
    const top = p.y + PLATFORM_THICKNESS / 2
    const onIt = Math.hypot(player.position.x - p.x, player.position.z - p.z) < PLATFORM_RADIUS && Math.abs(player.position.y - top) < 1.2
    if (onIt) return { level: LEVELS[lift.level].name, canUp: lift.level < LEVELS.length - 1, canDown: lift.level > 0, moving: lift.moving }
  }
  return null
}

export function buildHubLevels(): void {
  for (const side of [1, -1]) lifts.push(makeLift(side))
  buildDanceFloor()
  engine.addSystem(() => {
    for (const lift of lifts) followState(lift)
  })

  // E / F while standing on a platform rides it one level up / down.
  engine.addSystem(() => {
    const up = inputSystem.isTriggered(InputAction.IA_PRIMARY, PointerEventType.PET_DOWN)
    const down = inputSystem.isTriggered(InputAction.IA_SECONDARY, PointerEventType.PET_DOWN)
    if (!up && !down) return
    const player = Transform.getOrNull(engine.PlayerEntity)
    if (!player) return
    for (const lift of lifts) {
      const p = Transform.get(lift.platform).position
      const onIt = Math.hypot(player.position.x - p.x, player.position.z - p.z) < PLATFORM_RADIUS &&
        Math.abs(player.position.y - (p.y + PLATFORM_THICKNESS / 2)) < 1.2
      if (onIt) sendTo(lift, lift.level + (up ? 1 : -1))
    }
  })
}

function makeLift(side: number): Lift {
  const platform = engine.addEntity()
  Transform.create(platform, {
    position: platformAt(side, 0),
    scale: Vector3.create(PLATFORM_RADIUS * 2, PLATFORM_THICKNESS, PLATFORM_RADIUS * 2)
  })
  MeshRenderer.setCylinder(platform)
  MeshCollider.setCylinder(platform)
  Material.setPbrMaterial(platform, { albedoColor: Color4.create(0, 0.5, 0.7, 1), emissiveColor: GLOW, emissiveIntensity: 1.4, metallic: 0.6, roughness: 0.3 })

  const state = engine.addEntity()
  LiftState.create(state, { level: 0, target: 0, startedAt: 0 })
  syncEntity(state, [LiftState.componentId], LIFT_SYNC_IDS[side])

  const lift: Lift = { side, platform, state, gates: [], level: 0, moving: false, seen: null }
  for (let level = 0; level < LEVELS.length; level++) {
    lift.gates.push(level === 0 ? null : makeGate(side, level))
    makeCallButton(lift, level)
  }
  closeGates(lift)
  return lift
}

/** Where a level's opening onto the shaft is: the balcony landing's end, or the lounge well rail's gap. */
function openingX(level: number): { x: number; width: number } {
  if (level === LEVELS.length - 1) return { x: LIFT_R + 2.7 * Math.cos((40 * Math.PI) / 180), width: 2 * 2.7 * Math.sin((40 * Math.PI) / 180) + 0.2 }
  return { x: LIFT_R + PLATFORM_RADIUS + 0.1, width: 3.0 }
}

/** An invisible wall across a level's opening with a glowing bar along it; solid while the lift is elsewhere. */
function makeGate(side: number, level: number): Entity {
  const { x, width } = openingX(level)
  const gate = engine.addEntity()
  Transform.create(gate, {
    position: Vector3.create(CENTER.x + side * x, FLOOR_Y + LEVELS[level].height + 0.65, CENTER.z),
    scale: Vector3.create(0.1, 1.3, width)
  })
  const bar = engine.addEntity()
  Transform.create(bar, { parent: gate, position: Vector3.create(0, 0.1, 0), scale: Vector3.create(0.6, 0.05, 1) })
  MeshRenderer.setBox(bar)
  Material.setPbrMaterial(bar, { albedoColor: Color4.fromColor3(GATE, 1), emissiveColor: GATE, emissiveIntensity: 2 })
  return gate
}

function setGate(gate: Entity | null, closed: boolean): void {
  if (!gate) return
  if (closed) {
    MeshCollider.setBox(gate, ColliderLayer.CL_PHYSICS)
    Transform.getMutable(gate).scale.y = 1.3
  } else {
    MeshCollider.deleteFrom(gate)
    Transform.getMutable(gate).scale.y = 0.001 // hides the bar
  }
}

function closeGates(lift: Lift): void {
  lift.gates.forEach((g, level) => setGate(g, lift.moving || level !== lift.level))
}

/** A small glowing call button on a post beside each level's opening. */
function makeCallButton(lift: Lift, level: number): void {
  const { x, width } = openingX(level)
  const post = engine.addEntity()
  const r = level === 0 ? LIFT_R + PLATFORM_RADIUS + 0.9 : x + 0.35
  Transform.create(post, {
    // Beside the opening: on the hub floor just clear of the shaft; up top, just inside the landing's (or well's) rail.
    position: Vector3.create(CENTER.x + lift.side * r, FLOOR_Y + LEVELS[level].height + 1.1, CENTER.z + (level === 0 ? width / 2 + 0.25 : width / 2 - 0.25)),
    scale: Vector3.create(0.25, 0.25, 0.08),
    rotation: Quaternion.fromEulerDegrees(0, 90, 0)
  })
  MeshRenderer.setBox(post)
  MeshCollider.setBox(post, ColliderLayer.CL_POINTER)
  Material.setPbrMaterial(post, { albedoColor: Color4.fromColor3(GLOW, 1), emissiveColor: GLOW, emissiveIntensity: 2.5 })
  pointerEventsSystem.onPointerDown(
    { entity: post, opts: { button: InputAction.IA_POINTER, hoverText: `Call lift to ${LEVELS[level].name.toLowerCase()}`, maxDistance: 6 } },
    () => sendTo(lift, level)
  )
}

/** Ask for the lift: writes the synced state; every scene (this one included) then animates it. */
function sendTo(lift: Lift, target: number): void {
  if (lift.moving || target < 0 || target >= LEVELS.length || target === lift.level) return
  LiftState.createOrReplace(lift.state, { level: lift.level, target, startedAt: Date.now() })
}

const travelSeconds = (from: number, to: number) => Math.abs(LEVELS[to].height - LEVELS[from].height) / SPEED

/** Follow the synced state: start a ride when it changes, settle when the ride's time is up. */
function followState(lift: Lift): void {
  const st = LiftState.get(lift.state)
  const changed = !lift.seen || lift.seen.target !== st.target || lift.seen.startedAt !== Number(st.startedAt)
  if (!changed) return
  const firstLook = !lift.seen
  lift.seen = { target: st.target, startedAt: Number(st.startedAt) }
  if (st.target === st.level) {
    settle(lift, st.target)
    return
  }
  const seconds = travelSeconds(st.level, st.target)
  // A ride already under way when we joined: finish what's left of it (or skip it if it's over). Otherwise it
  // starts now, whatever the sender's clock said: a moment behind the rider, rather than trusting two clocks.
  const elapsed = firstLook ? Math.max(0, (Date.now() - Number(st.startedAt)) / 1000) : 0
  if (elapsed >= seconds) {
    settle(lift, st.target)
    return
  }
  const from = firstLook ? lerp(platformAt(lift.side, st.level), platformAt(lift.side, st.target), elapsed / seconds) : platformAt(lift.side, st.level)
  const remaining = seconds - elapsed
  lift.moving = true
  closeGates(lift)
  Tween.setMove(lift.platform, from, platformAt(lift.side, st.target), remaining * 1000, firstLook ? EasingFunction.EF_LINEAR : EasingFunction.EF_EASESINE)
  let t = 0
  const wait = (dt: number) => {
    t += dt
    if (t < remaining + DWELL) return
    engine.removeSystem(wait)
    // Only if nothing newer arrived meanwhile.
    if (lift.seen?.target === st.target) settle(lift, st.target)
  }
  engine.addSystem(wait)
}

function settle(lift: Lift, level: number): void {
  Tween.deleteFrom(lift.platform)
  Transform.getMutable(lift.platform).position = platformAt(lift.side, level)
  lift.level = level
  lift.moving = false
  closeGates(lift)
}

const lerp = (a: Vector3, b: Vector3, t: number) => Vector3.create(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t)

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
