// The hub's two lifts, as elevators. Each is a solid platform in a vertical shaft (the explorer carries a standing
// avatar with it, so nothing moves the player directly). Riders pick floors on a panel (the HUD, or number keys 1-4
// while standing on the platform); each landing has up / down call buttons. The dispatching is controller.ts.
//
// Shared between the players at the same station, and only them: each station's lifts are synced under their own
// network ids (from the station's id), so two stations sharing the world don't drive each other's lifts. Following
// rebel-radio's sync.ts: sync intent, not animation. A small state component (where the car is, where it's going,
// the calls) is synced; every scene animates its own platform from it; late joiners snap to where the car is.
// Nobody writes until the synced state has arrived (or 2 s have passed, for an empty station or a preview).
//
// There's no host: every scene runs the same dispatching on the same state, and the first to act after a short
// random delay writes the next step; the others see the state has moved on and stand down.
import {
  engine, Entity, Transform, MeshRenderer, MeshCollider, Material, Tween, EasingFunction, PointerEventType,
  InputAction, inputSystem, pointerEventsSystem, ColliderLayer, Schemas, TextShape, Billboard, BillboardMode
} from '@dcl/sdk/ecs'
import { Vector3, Color4, Color3 } from '@dcl/sdk/math'
import { syncEntity, isStateSyncronized } from '@dcl/sdk/network'
import { CENTER, FLOOR_Y } from '../station'
import { onGateChanged, getGateState, GateState } from '../gate'
import { Calls, Dir, has, withCall, serve, next } from './controller'

export const FLOORS = [
  { name: 'HUB FLOOR', height: 0 },
  { name: 'OBSERVATION DECK', height: 9 },
  { name: 'UPPER DOCKS', height: 17 },
  { name: 'SPACE BAR LOUNGE', height: 25 }
]
const LIFT_R = 17 // the shaft's centre: in the open atrium (balconies start at 20 m) and through the lounge's wells
const PLATFORM_RADIUS = 1.5 // build_station_models.py LIFT_PLATFORM_R
const PLATFORM_THICKNESS = 0.12
const SPEED = 2.5 // m/s
const GATE_DELAY = 0.4 // seconds after arriving before the gate opens
const DOOR_TIME = 3 // seconds a car waits at a stop before going on
const JITTER = 0.4 // up to this long before a scene acts on a decision, so they rarely act at once
const SETTLE = 2 // seconds to wait for synced state before writing (rebel-radio's SYNC_SETTLE_SECONDS)
const NUMBER_KEYS = [InputAction.IA_ACTION_3, InputAction.IA_ACTION_4, InputAction.IA_ACTION_5, InputAction.IA_ACTION_6] // keys 1-4
const GLOW = Color3.create(0, 0.9, 1)
const GATE = Color3.create(1, 0.25, 0.8)
const LIT = Color3.create(1, 0.75, 0.2)

const LiftState = engine.defineComponent('stellar::LiftState', {
  at: Schemas.Int, // the floor the car is at, or last left
  target: Schemas.Int, // where it's going (= at when stopped)
  departAt: Schemas.Int64, // when it set off (ms, the writer's clock; only late joiners use it)
  dir: Schemas.Int, // -1 down, 0 idle, 1 up
  up: Schemas.Int, // hall calls going up (bit per floor)
  down: Schemas.Int, // hall calls going down
  car: Schemas.Int, // floors picked inside the car
  seq: Schemas.Int // bumped on every write
})
type State = { at: number; target: number; departAt: number; dir: number; up: number; down: number; car: number; seq: number }

type Lift = {
  side: number
  platform: Entity
  gates: (Entity | null)[]
  buttons: { entity: Entity; floor: number; dir: 1 | -1 }[]
  state: Entity // this station's synced LiftState (or a local one before the station is known)
  stateSince: number // when `state` was created, for the settle wait
  // What this scene shows:
  at: number
  moving: boolean
  arriveAt: number // scene time the current ride ends
  arrivedAt: number // scene time the car last stopped
  seenMove: string | null // the ride this scene last acted on
  pending: { at: number; seq: number } | null // a write this scene means to make, and the state it was based on
  painted: string // the calls the buttons last showed
}

const lifts: Lift[] = []
let clock = 0 // scene seconds

const platformAt = (side: number, floor: number) =>
  Vector3.create(CENTER.x + side * LIFT_R, FLOOR_Y + FLOORS[floor].height + 0.01 - PLATFORM_THICKNESS / 2, CENTER.z)
const travelSeconds = (from: number, to: number) => Math.abs(FLOORS[to].height - FLOORS[from].height) / SPEED
const read = (e: Entity): State => {
  const s = LiftState.get(e)
  return { at: s.at, target: s.target, departAt: Number(s.departAt), dir: s.dir, up: s.up, down: s.down, car: s.car, seq: s.seq }
}

// ---- which station's lifts --------------------------------------------------------------------------------

/** A network id for a station's lift, the same on every client at that station (FNV-1a of its id). */
function syncId(stationId: string, side: number): number {
  let h = 0x811c9dc5
  for (const ch of stationId) {
    h ^= ch.charCodeAt(0)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return 720000 + (h % 20000) * 2 + (side > 0 ? 0 : 1)
}

function newState(side: number, stationId: string | null): Entity {
  const e = engine.addEntity()
  LiftState.create(e, { at: 0, target: 0, departAt: 0, dir: 0, up: 0, down: 0, car: 0, seq: 0 })
  if (stationId) syncEntity(e, [LiftState.componentId], syncId(stationId, side))
  return e
}

function useStation(stationId: string | null): void {
  for (const lift of lifts) {
    lift.state = newState(lift.side, stationId) // a station change (admins) moves on to that station's lifts
    lift.stateSince = clock
    lift.seenMove = null
    lift.pending = null
  }
}

const settled = (lift: Lift) => isStateSyncronized() || clock - lift.stateSince >= SETTLE

function write(lift: Lift, change: Partial<State>): void {
  const s = read(lift.state)
  LiftState.createOrReplace(lift.state, { ...s, ...change, seq: s.seq + 1 })
}

// ---- building ---------------------------------------------------------------------------------------------

export function buildLifts(): void {
  for (const side of [1, -1]) lifts.push(makeLift(side))
  let station: string | null = null
  const onGate = (gate: GateState) => {
    const next = gate.kind === 'aboard' ? gate.stationId : null
    if (next && next !== station) {
      station = next
      useStation(station)
    }
  }
  onGateChanged(onGate)
  onGate(getGateState())

  engine.addSystem((dt) => {
    clock += dt
    for (const lift of lifts) run(lift)
    // Number keys 1-4 pick a floor while standing on a platform.
    const lift = liftUnder()
    if (!lift) return
    NUMBER_KEYS.forEach((key, floor) => {
      if (inputSystem.isTriggered(key, PointerEventType.PET_DOWN)) pressCar(lift, floor)
    })
  })
}

function makeLift(side: number): Lift {
  const platform = engine.addEntity()
  Transform.create(platform, { position: platformAt(side, 0), scale: Vector3.create(PLATFORM_RADIUS * 2, PLATFORM_THICKNESS, PLATFORM_RADIUS * 2) })
  MeshRenderer.setCylinder(platform)
  MeshCollider.setCylinder(platform)
  Material.setPbrMaterial(platform, { albedoColor: Color4.create(0, 0.5, 0.7, 1), emissiveColor: GLOW, emissiveIntensity: 1.4, metallic: 0.6, roughness: 0.3 })
  const lift: Lift = {
    side, platform, gates: [], buttons: [], state: newState(side, null), stateSince: 0,
    at: 0, moving: false, arriveAt: 0, arrivedAt: -99, seenMove: null, pending: null, painted: ''
  }
  for (let floor = 0; floor < FLOORS.length; floor++) {
    lift.gates.push(floor === 0 ? null : makeGate(side, floor))
    makeCallButtons(lift, floor)
  }
  setGates(lift)
  return lift
}

/** Where a floor's opening onto the shaft is: the balcony landing's end, or the lounge well rail's gap. */
function openingX(floor: number): { x: number; width: number } {
  if (floor === FLOORS.length - 1) return { x: LIFT_R + 2.7 * Math.cos((40 * Math.PI) / 180), width: 2 * 2.7 * Math.sin((40 * Math.PI) / 180) + 0.2 }
  return { x: LIFT_R + PLATFORM_RADIUS + 0.1, width: 3.0 }
}

/** An invisible wall across a floor's opening with a glowing bar along it; solid while the car is elsewhere. */
function makeGate(side: number, floor: number): Entity {
  const { x, width } = openingX(floor)
  const gate = engine.addEntity()
  Transform.create(gate, { position: Vector3.create(CENTER.x + side * x, FLOOR_Y + FLOORS[floor].height + 0.65, CENTER.z), scale: Vector3.create(0.1, 1.3, width) })
  const bar = engine.addEntity()
  Transform.create(bar, { parent: gate, position: Vector3.create(0, 0.1, 0), scale: Vector3.create(0.6, 0.05, 1) })
  MeshRenderer.setBox(bar)
  Material.setPbrMaterial(bar, { albedoColor: Color4.fromColor3(GATE, 1), emissiveColor: GATE, emissiveIntensity: 2 })
  return gate
}

function setGates(lift: Lift): void {
  lift.gates.forEach((gate, floor) => {
    if (!gate) return
    const open = !lift.moving && lift.at === floor && clock - lift.arrivedAt >= GATE_DELAY
    const t = Transform.getMutable(gate)
    if (open && MeshCollider.has(gate)) {
      MeshCollider.deleteFrom(gate)
      t.scale = Vector3.create(t.scale.x, 0.001, t.scale.z) // hides the bar
    } else if (!open && !MeshCollider.has(gate)) {
      MeshCollider.setBox(gate, ColliderLayer.CL_PHYSICS)
      t.scale = Vector3.create(t.scale.x, 1.3, t.scale.z)
    }
  })
}

/** Up and down call buttons on a small console beside each floor's opening (up only at the bottom, down only at the top). */
function makeCallButtons(lift: Lift, floor: number): void {
  const { x, width } = openingX(floor)
  const r = floor === 0 ? LIFT_R + PLATFORM_RADIUS + 0.9 : x + 0.35
  const z = CENTER.z + (floor === 0 ? width / 2 + 0.25 : width / 2 - 0.25)
  const y = FLOOR_Y + FLOORS[floor].height
  const dirs: (1 | -1)[] = floor === 0 ? [1] : floor === FLOORS.length - 1 ? [-1] : [1, -1]
  dirs.forEach((dir) => {
    const button = engine.addEntity()
    Transform.create(button, {
      position: Vector3.create(CENTER.x + lift.side * r, y + (dirs.length === 1 ? 1.1 : dir === 1 ? 1.3 : 0.95), z),
      scale: Vector3.create(0.22, 0.22, 0.22)
    })
    MeshRenderer.setSphere(button)
    MeshCollider.setSphere(button, ColliderLayer.CL_POINTER)
    const label = engine.addEntity()
    Transform.create(label, { parent: button, position: Vector3.create(0, 0, 0) })
    TextShape.create(label, { text: dir === 1 ? '▲' : '▼', fontSize: 5, textColor: Color4.create(0.05, 0.05, 0.1, 1) })
    Billboard.create(label, { billboardMode: BillboardMode.BM_Y })
    pointerEventsSystem.onPointerDown(
      { entity: button, opts: { button: InputAction.IA_POINTER, hoverText: `Call lift ${dir === 1 ? 'up' : 'down'}`, maxDistance: 6 } },
      () => pressHall(lift, floor, dir)
    )
    lift.buttons.push({ entity: button, floor, dir })
  })
}

// ---- asking for the lift ----------------------------------------------------------------------------------

function pressCar(lift: Lift, floor: number): void {
  if (!settled(lift)) return
  const s = read(lift.state)
  if (has(s.car, floor) || (!lift.moving && lift.at === floor)) return
  write(lift, { car: withCall(s.car, floor) })
}

function pressHall(lift: Lift, floor: number, dir: 1 | -1): void {
  if (!settled(lift)) return
  const s = read(lift.state)
  const mask = dir === 1 ? s.up : s.down
  if (has(mask, floor)) return
  write(lift, dir === 1 ? { up: withCall(mask, floor) } : { down: withCall(mask, floor) })
}

// ---- running a lift ---------------------------------------------------------------------------------------

function run(lift: Lift): void {
  const s = read(lift.state)
  follow(lift, s)
  if (lift.moving && clock >= lift.arriveAt) arrive(lift, s.target)
  setGates(lift)
  paintButtons(lift, s)
  if (!lift.moving && settled(lift)) dispatch(lift, s)
}

/** Start (or, for a late joiner, pick up) the ride the state describes. */
function follow(lift: Lift, s: State): void {
  const key = `${s.at}|${s.target}|${s.departAt}`
  if (key === lift.seenMove) return
  // Rides seen before this station's state has settled may have set off before we joined.
  const firstLook = lift.seenMove === null || clock - lift.stateSince < SETTLE + 1
  lift.seenMove = key
  if (s.target === s.at) {
    if (lift.moving || lift.at !== s.at) arrive(lift, s.at)
    return
  }
  const seconds = travelSeconds(s.at, s.target)
  // A ride already under way when we joined: finish what's left (or skip it if it's over). Otherwise it starts now,
  // a moment behind the scene that set it off, rather than trusting two clocks.
  const elapsed = firstLook ? Math.max(0, (Date.now() - s.departAt) / 1000) : 0
  if (elapsed >= seconds) {
    arrive(lift, s.target)
    return
  }
  const from = firstLook ? lerp(platformAt(lift.side, s.at), platformAt(lift.side, s.target), elapsed / seconds) : platformAt(lift.side, s.at)
  lift.moving = true
  lift.arriveAt = clock + seconds - elapsed
  Tween.setMove(lift.platform, from, platformAt(lift.side, s.target), (seconds - elapsed) * 1000, firstLook ? EasingFunction.EF_LINEAR : EasingFunction.EF_EASESINE)
}

function arrive(lift: Lift, floor: number): void {
  Tween.deleteFrom(lift.platform)
  Transform.getMutable(lift.platform).position = platformAt(lift.side, floor)
  lift.at = floor
  lift.moving = false
  lift.arrivedAt = clock
}

/**
 * Act on the state when stopped: answer the calls at this floor at once, and after the car's stop time set off for
 * the next one. Each step is written after a short random delay, and only if nobody changed the state meanwhile.
 */
function dispatch(lift: Lift, s: State): void {
  const calls: Calls = { up: s.up, down: s.down, car: s.car }
  const dir = s.dir as Dir
  const answered = serve(lift.at, dir, calls, FLOORS.length)
  const changed = answered.up !== calls.up || answered.down !== calls.down || answered.car !== calls.car
  const go = next(lift.at, dir, answered, FLOORS.length)
  const due = changed || (go !== null && clock - lift.arrivedAt >= DOOR_TIME) || (go === null && dir !== 0)
  if (!due) {
    lift.pending = null
    return
  }
  if (!lift.pending || lift.pending.seq !== s.seq) {
    lift.pending = { at: clock + Math.random() * JITTER, seq: s.seq }
    return
  }
  if (clock < lift.pending.at) return
  lift.pending = null
  if (changed) {
    write(lift, { ...answered, at: lift.at, target: lift.at }) // answered: the car stays, its calls here go out
  } else if (go) {
    write(lift, { ...answered, at: lift.at, target: go.target, dir: go.dir, departAt: Date.now() })
  } else {
    write(lift, { at: lift.at, target: lift.at, dir: 0 }) // nothing left: idle
  }
}

/** Hall buttons glow while their call is waiting. */
function paintButtons(lift: Lift, s: State): void {
  const key = `${s.up}|${s.down}`
  if (key === lift.painted) return
  lift.painted = key
  for (const b of lift.buttons) {
    const lit = has(b.dir === 1 ? s.up : s.down, b.floor)
    Material.setPbrMaterial(b.entity, {
      albedoColor: Color4.fromColor3(lit ? LIT : GLOW, 1),
      emissiveColor: lit ? LIT : GLOW,
      emissiveIntensity: lit ? 3.5 : 1.5
    })
  }
}

const lerp = (a: Vector3, b: Vector3, t: number) => Vector3.create(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t)

// ---- the rider's panel ------------------------------------------------------------------------------------

/** The lift the player is standing on, if any. */
function liftUnder(): Lift | null {
  const player = Transform.getOrNull(engine.PlayerEntity)
  if (!player) return null
  for (const lift of lifts) {
    const p = Transform.get(lift.platform).position
    const onIt = Math.hypot(player.position.x - p.x, player.position.z - p.z) < PLATFORM_RADIUS &&
      Math.abs(player.position.y - (p.y + PLATFORM_THICKNESS / 2)) < 1.2
    if (onIt) return lift
  }
  return null
}

export type LiftPanel = {
  floors: { name: string; key: string; here: boolean; picked: boolean; press: () => void }[]
  moving: boolean
  dir: number
}

/** What the HUD shows while the player is on a lift: the floors, which is here and which are picked. */
export function liftPanel(): LiftPanel | null {
  const lift = liftUnder()
  if (!lift) return null
  const s = read(lift.state)
  return {
    floors: FLOORS.map((f, i) => ({
      name: f.name,
      key: `${i + 1}`,
      here: !lift.moving && lift.at === i,
      picked: has(s.car, i),
      press: () => pressCar(lift, i)
    })),
    moving: lift.moving,
    dir: s.dir
  }
}
