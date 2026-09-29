// Venue effects must not churn the explorer all session: Terra's glitches only run inside Terra, and the arcade
// screens and the lab sign change in fixed steps (a small reused set of looks, not a new one per write).
import { describe, it, expect, vi, afterEach } from 'vitest'
import { engine, Transform, GltfContainer, Material, MeshRenderer, TextShape } from '@dcl/sdk/ecs'
import { Vector3 } from '@dcl/sdk/math'
import { tick } from './helpers'
import { CENTER, FLOOR_Y } from '../src/station'

import { buildTerra } from '../src/terra/terra'
import { buildArcade } from '../src/arcade/arcade'
import { buildLab } from '../src/lab/lab'

const putPlayer = (p: Vector3) => Transform.createOrReplace(engine.PlayerEntity, { position: p })
afterEach(() => { vi.restoreAllMocks() })

describe('Terra', () => {
  it('glitches only while the player is inside it', async () => {
    buildTerra()
    let terra: Vector3 | null = null
    for (const [e, g] of engine.getEntitiesWith(GltfContainer)) if (g.src.includes('terra.glb')) terra = Transform.get(e).position
    expect(terra).not.toBeNull()
    putPlayer(Vector3.create(CENTER.x, FLOOR_Y, CENTER.z))   // out in the hub
    await tick(1)
    const meshes = vi.spyOn(MeshRenderer, 'setPlane')
    await tick(60)
    expect(meshes).not.toHaveBeenCalled()                    // was ~280 random-UV meshes a minute, anywhere
    putPlayer(Vector3.create(terra!.x, FLOOR_Y, terra!.z))
    await tick(60)
    expect(meshes.mock.calls.length).toBeGreaterThan(0)      // inside, it still glitches
  })
})

describe('arcade attract screens', () => {
  it('drift through a small fixed set of colours', async () => {
    buildArcade()
    const materials = vi.spyOn(Material, 'setPbrMaterial')
    await tick(120)
    const looks = new Set(materials.mock.calls.map(c => JSON.stringify((c[1] as any).emissiveColor)))
    expect(looks.size).toBeLessThan(100)            // a few palettes x 8 steps (was a new colour on every write)
  })
})

describe('lab sign', () => {
  it('breathes in steps instead of rewriting its text every frame', async () => {
    buildLab()
    const text = vi.spyOn(TextShape, 'getMutable')
    await tick(10)
    expect(text.mock.calls.length).toBeLessThan(150)   // was 600 in these 10 s
  })
})
