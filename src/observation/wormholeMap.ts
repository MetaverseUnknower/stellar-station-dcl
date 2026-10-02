// The Eld's wormhole map on the galaxy hologram (galaxyHologram.ts), for players who bought it at the Eld's relay
// (blackMarket/): every known wormhole in their galaxy and where it leads. Linked black holes are joined by a violet
// beam; a black hole not linked yet wears a broken ring; a timed wormhole is a beam from the galaxy's heart to its
// target, bright and pulsing while open (gold when the Eld built it), dashed while scheduled, with a red diamond over
// a private one. The hologram's stars can't be pointed at, so names hang under them (the heat map's counts sit above).
// Each visitor draws the hologram for themselves: only owners see this.
//
// The server builds the map fresh (GET /api/black-market/wormhole-map; 403 when not owned). It's fetched once aboard
// and every 5 minutes after, one request at a time, and redrawn only when it changed. A wormhole star the hologram
// hasn't got (found since it loaded its stars) has it reload them, once per new map.
import { engine, Entity, Transform, MeshRenderer, Material, MaterialTransparencyMode, TextShape, Billboard, BillboardMode } from '@dcl/sdk/ecs'
import { Color3, Color4, Vector3, Quaternion } from '@dcl/sdk/math'
import { getMarketMine, getWormholeMap, type WormholeMap } from '../stationApi'
import { starEntities, getGalaxyRoot, addMapRenderHooks } from '../galaxyMap'
import { onGateChanged } from '../gate'

const POLL_SECONDS = 300
const OWNERSHIP_RETRY_SECONDS = 60 // a failed ownership check, tried again
const PULSE_STEP = 0.1 // the open wormholes' beams: ten checks a second, a write only when the step changes
const BEAM = 0.012 // beam radius, in the map's units (its stars are 0.05–0.15 across)
const DASH = 0.12 // a scheduled wormhole's dash, and the gap after it
const MAX_DASHES = 60
const RING = 0.13 // a dormant black hole's ring
const LABEL_DROP = 0.16 // names hang under the star
const VIOLET = Color3.create(0.62, 0.4, 1)
const DIM_VIOLET = Color3.create(0.42, 0.3, 0.7)
const GOLD = Color3.create(1, 0.78, 0.3) // an open or scheduled wormhole the Eld built
const ICE = Color3.create(0.55, 0.85, 1) // one an admin made
const LOCK = Color3.create(1, 0.35, 0.45) // a private wormhole's diamond

export type Part = 'beam' | 'dash' | 'ring' | 'cap' | 'label'

let owned = false
let aboard = false
let ownership: 'unchecked' | 'checking' | 'checked' = 'unchecked'
let sinceOwnershipCheck = 0
let map: WormholeMap | null = null
let mapKey = '' // the last map fetched, as JSON
let drawnKey = '' // the map on the hologram ('' = nothing drawn)
let parts: { entity: Entity; part: Part }[] = []
let openBeams: { entity: Entity; color: Color3; step: number }[] = [] // every open wormhole's beam, and the look last written
let inFlight = false
let sincePoll = 0
let pulseTimer = 0
let t = 0
let reloadStars: (() => Promise<void>) | null = null
let reloadedFor = '' // the map key the stars were last reloaded for

const hhmm = (iso: string) => `${new Date(iso).toISOString().slice(11, 16)} UTC`
const look = (c: Color3, glow: number, alpha: number) => ({
  albedoColor: Color4.create(c.r, c.g, c.b, alpha),
  emissiveColor: c,
  emissiveIntensity: glow,
  transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND,
  castShadows: false
})

export function setupWormholeMap(reload: () => Promise<void>): void {
  reloadStars = reload
  addMapRenderHooks({ rendered: draw, cleared: clear })
  engine.addSystem(wormholeMapSystem)
  onGateChanged((gate) => {
    aboard = gate.kind === 'aboard'
    if (aboard && ownership === 'unchecked') checkOwnership()
  })
}

/** Does the player own the map? A failed check is tried again a minute later (wormholeMapSystem). */
function checkOwnership(): void {
  ownership = 'checking'
  sinceOwnershipCheck = 0
  getMarketMine()
    .then((mine) => {
      ownership = 'checked'
      if (mine.wormholeMap) wormholeMapOwned()
    })
    .catch(() => { ownership = 'unchecked' })
}

/** The player owns the map (just bought it, or it's on record): show it now and keep it current. */
export function wormholeMapOwned(): void {
  if (owned) return
  owned = true
  void poll()
}

/** What's drawn, by kind, and the labels' text (for tests). */
export function wormholeMapParts(): Record<Part, number> & { labels: string[]; entities: Entity[] } {
  const count: Record<Part, number> = { beam: 0, dash: 0, ring: 0, cap: 0, label: 0 }
  for (const p of parts) count[p.part]++
  const labels = parts.filter((p) => p.part === 'label').map((p) => TextShape.get(p.entity).text)
  return { ...count, labels, entities: parts.map((p) => p.entity) }
}

async function poll(): Promise<void> {
  if (inFlight || !owned) return
  inFlight = true
  sincePoll = 0
  try {
    const next = await getWormholeMap()
    if (next === null) {
      // Not owned (any more): an admin took it back
      owned = false
      map = null
      mapKey = ''
      clear()
      return
    }
    const key = JSON.stringify(next)
    if (key === mapKey) return
    map = next
    mapKey = key
    draw()
  } catch {
    /* keep what's drawn; with nothing drawn yet, try again in a minute rather than five */
    if (mapKey === '') sincePoll = POLL_SECONDS - OWNERSHIP_RETRY_SECONDS
  } finally {
    inFlight = false
  }
}

function clear(): void {
  for (const p of parts) engine.removeEntity(p.entity)
  parts = []
  openBeams = []
  drawnKey = ''
}

function wanted(m: WormholeMap): string[] {
  return [...m.links.flatMap((l) => [l.a.id, l.b.id]), ...m.dormant.map((d) => d.id), ...m.events.map((e) => e.target.id)]
}

function draw(): void {
  if (!map || drawnKey === mapKey) return
  const at = new Map<string, Vector3>()
  for (const [star, system] of starEntities) at.set(system.id, Transform.get(star).position)
  if (at.size === 0) return // the hologram hasn't drawn its stars yet; its render hook calls back
  if (reloadStars && reloadedFor !== mapKey && wanted(map).some((id) => !at.has(id))) {
    reloadedFor = mapKey
    void reloadStars().catch(() => {}) // redraws through the render hook; meanwhile, draw what we can
  }
  clear()
  const root = getGalaxyRoot()
  const centre = Vector3.Zero()

  for (const link of map.links) {
    const a = at.get(link.a.id)
    const b = at.get(link.b.id)
    if (!a || !b) continue
    segment(root, a, b, VIOLET, 2.5, 0.6, 'beam')
    label(root, a, link.a.name, VIOLET)
    label(root, b, link.b.name, VIOLET)
  }
  for (const hole of map.dormant) {
    const p = at.get(hole.id)
    if (!p) continue
    ring(root, p)
    label(root, p, hole.name, DIM_VIOLET)
  }
  for (const ev of map.events) {
    const p = at.get(ev.target.id)
    if (!p) continue
    const colour = ev.eldBuilt ? GOLD : ICE
    if (ev.status === 'open') {
      const beam = segment(root, centre, p, colour, 4, 0.7, 'beam')
      if (beam) openBeams.push({ entity: beam, color: colour, step: -1 })
    } else {
      dashes(root, centre, p, colour)
    }
    if (ev.exclusive) cap(root, p)
    label(root, p, ev.status === 'open' ? `WORMHOLE · until ${hhmm(ev.endsAt)}` : `WORMHOLE · opens ${hhmm(ev.startsAt)}`, colour, LABEL_DROP * 2)
  }
  drawnKey = mapKey
}

/** A thin glowing cylinder from `from` to `to` (none when they coincide). */
function segment(root: Entity, from: Vector3, to: Vector3, colour: Color3, glow: number, alpha: number, part: Part): Entity | null {
  const d = Vector3.subtract(to, from)
  const length = Vector3.length(d)
  if (length < 1e-4) return null
  const e = engine.addEntity()
  Transform.create(e, {
    parent: root,
    position: Vector3.lerp(from, to, 0.5),
    rotation: Quaternion.fromToRotation(Vector3.Up(), Vector3.normalize(d)),
    scale: Vector3.create(BEAM * 2, length, BEAM * 2)
  })
  MeshRenderer.setCylinder(e)
  Material.setPbrMaterial(e, look(colour, glow, alpha))
  parts.push({ entity: e, part })
  return e
}

function dashes(root: Entity, from: Vector3, to: Vector3, colour: Color3): void {
  const length = Vector3.distance(from, to)
  const n = Math.min(MAX_DASHES, Math.floor(length / (DASH * 2)))
  for (let i = 0; i < n; i++) {
    const a = Vector3.lerp(from, to, (i * 2 * DASH) / length)
    const b = Vector3.lerp(from, to, ((i * 2 + 1) * DASH) / length)
    segment(root, a, b, colour, 1.5, 0.35, 'dash')
  }
}

/** Four short arcs round a dormant black hole, flat in the galaxy's plane. */
function ring(root: Entity, p: Vector3): void {
  const at = (deg: number) => {
    const r = (deg * Math.PI) / 180
    return Vector3.create(p.x + Math.cos(r) * RING, p.y, p.z + Math.sin(r) * RING)
  }
  for (const mid of [45, 135, 225, 315]) segment(root, at(mid - 25), at(mid + 25), DIM_VIOLET, 1, 0.5, 'ring')
}

/** A small red diamond over a private wormhole's target. */
function cap(root: Entity, p: Vector3): void {
  const e = engine.addEntity()
  Transform.create(e, {
    parent: root,
    position: Vector3.create(p.x, p.y + 0.14, p.z),
    rotation: Quaternion.fromEulerDegrees(45, 0, 45),
    scale: Vector3.create(0.05, 0.05, 0.05)
  })
  MeshRenderer.setBox(e)
  Material.setPbrMaterial(e, look(LOCK, 3, 1))
  parts.push({ entity: e, part: 'cap' })
}

function label(root: Entity, p: Vector3, text: string, colour: Color3, drop = LABEL_DROP): void {
  const e = engine.addEntity()
  Transform.create(e, { parent: root, position: Vector3.create(p.x, p.y - drop, p.z) })
  TextShape.create(e, { text, fontSize: 1.4, textColor: Color4.create(colour.r, colour.g, colour.b, 1), outlineWidth: 0.15, outlineColor: Color3.Black() })
  Billboard.create(e, { billboardMode: BillboardMode.BM_Y })
  parts.push({ entity: e, part: 'label' })
}

function wormholeMapSystem(dt: number): void {
  if (!owned) {
    if (aboard && ownership === 'unchecked') {
      sinceOwnershipCheck += dt
      if (sinceOwnershipCheck >= OWNERSHIP_RETRY_SECONDS) checkOwnership()
    }
    return
  }
  if (!aboard) return // polled while aboard only; owned stays true across an undock, so polling resumes on return
  sincePoll += dt
  if (sincePoll >= POLL_SECONDS) void poll()
  if (openBeams.length === 0) return
  t += dt
  pulseTimer -= dt
  if (pulseTimer > 0) return
  pulseTimer = PULSE_STEP
  // The beam steps through eleven looks and is written only when the step changes
  const step = Math.round((0.5 + 0.5 * Math.sin(t * 3)) * 10) / 10
  for (const beam of openBeams) {
    if (beam.step === step) continue
    beam.step = step
    Material.setPbrMaterial(beam.entity, look(beam.color, 3 + step * 4, 0.5 + 0.4 * step))
  }
}
