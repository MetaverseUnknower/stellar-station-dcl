// Terra's trees: a different grove at every station. Species, number, placement, size and turn all come from a
// random source seeded with the station's id, so everyone docked at a station sees the same trees, and each station
// its own. The models are tools/build_terra_trees.py's: oak, birch, spruce and a weeping willow (two of each).
//
// Trees stand on the lawn clear of the river, the path from the door, the benches and the flowerbeds, apart from
// each other, and small enough to fit under the sky (the shell leans in above ~5 m); willows like the riverbank.
import { engine, Entity, Transform, GltfContainer, ColliderLayer } from '@dcl/sdk/ecs'
import { Vector3, Quaternion } from '@dcl/sdk/math'

type Species = { model: string; height: number; reach: number; weight: number; riverside?: boolean }
// Heights and reaches as the build reports them (metres, before scaling).
const SPECIES: Species[] = [
  { model: 'oak_1', height: 5.6, reach: 2.89, weight: 3 },
  { model: 'oak_2', height: 5.75, reach: 3.17, weight: 3 },
  { model: 'birch_1', height: 5.91, reach: 2.73, weight: 3 },
  { model: 'birch_2', height: 6.26, reach: 2.32, weight: 3 },
  { model: 'spruce_1', height: 6.33, reach: 2.54, weight: 2 },
  { model: 'spruce_2', height: 6.58, reach: 2.63, weight: 2 },
  { model: 'willow_1', height: 4.81, reach: 2.68, weight: 1, riverside: true },
  { model: 'willow_2', height: 4.15, reach: 3.05, weight: 1, riverside: true }
]

/** Where trees can't go, in the room's own frame (x toward the river, away from the door; y across). */
export type Keepout = {
  inRiver: (x: number, y: number, margin: number) => boolean
  riverNearEdge: (y: number) => number // x of the near bank
  benches: { x: number; y: number }[]
  beds: { x: number; y: number }[]
}

function seeded(text: string): () => number {
  let h = 0x811c9dc5
  for (const ch of text) {
    h ^= ch.charCodeAt(0)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  let a = h
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const SKY_EDGE = 8.4 // a crown's outside must stay this close to the room's centre (the shell is ~8.9 m out below 5 m)
const SKY_TOP = 6.6 // and its top this low
const SPACING = 2.6 // between trunks

export type TreeSpot = { model: string; x: number; y: number; yaw: number; scale: number }

/** The grove for a station: 5 to 8 trees, placed by the station's own random source. */
export function grove(stationId: string, keep: Keepout): TreeSpot[] {
  const rand = seeded(`terra:${stationId}`)
  const want = 5 + Math.floor(rand() * 4)
  const out: TreeSpot[] = []
  for (let tries = 0; tries < 400 && out.length < want; tries++) {
    const r = 2.8 + rand() * 5.0
    const a = rand() * Math.PI * 2
    const x = Math.cos(a) * r
    const y = Math.sin(a) * r
    if (x < -5.8) continue // the doorway and its portal
    if (x < 2.8 && Math.abs(y) < 1.6) continue // the path from the door
    if (keep.inRiver(x, y, 0.35)) continue
    if (keep.benches.some((b) => Math.hypot(x - b.x, y - b.y) < 2.2)) continue
    if (keep.beds.some((b) => Math.hypot(x - b.x, y - b.y) < 1.3)) continue
    if (out.some((t) => Math.hypot(x - t.x, y - t.y) < SPACING)) continue
    // By the river, often a willow; elsewhere, by weight.
    const byRiver = x > keep.riverNearEdge(y) - 1.4
    const pool = byRiver && rand() < 0.6 ? SPECIES.filter((s) => s.riverside) : SPECIES.filter((s) => !s.riverside || byRiver)
    const total = pool.reduce((n, s) => n + s.weight, 0)
    let pick = rand() * total
    let species = pool[0]
    for (const s of pool) {
      pick -= s.weight
      if (pick <= 0) {
        species = s
        break
      }
    }
    // Sized to fit: a little variety, then shrunk if its crown would reach the sky.
    let scale = 0.85 + rand() * 0.3
    scale = Math.min(scale, (SKY_EDGE - r) / species.reach, SKY_TOP / species.height)
    if (scale < 0.6) continue
    out.push({ model: species.model, x, y, yaw: rand() * 360, scale })
  }
  return out
}

/** Plant a grove: `place` turns a spot in the room's frame into a scene position. Returns the trees' entities. */
export function plant(spots: TreeSpot[], place: (x: number, y: number) => Vector3): Entity[] {
  return spots.map((t) => {
    const e = engine.addEntity()
    Transform.create(e, {
      position: place(t.x, t.y),
      rotation: Quaternion.fromEulerDegrees(0, t.yaw, 0),
      scale: Vector3.create(t.scale, t.scale, t.scale)
    })
    GltfContainer.create(e, {
      src: `assets/models/terra/trees/${t.model}.glb`,
      visibleMeshesCollisionMask: ColliderLayer.CL_NONE,
      invisibleMeshesCollisionMask: ColliderLayer.CL_PHYSICS // the trunk
    })
    return e
  })
}
