// The station's holograms (copied from the ship): the star glow and the beam must not re-set materials every frame.
import { it, expect, vi, afterEach } from 'vitest'
import { Material } from '@dcl/sdk/ecs'

vi.mock('../src/api', async (orig) => ({
  ...(await orig<any>()),
  getSystemDetail: vi.fn(async () => ({
    system: { id: 's1', name: 'Test', star_type: 'yellow_star' },
    planets: [{ id: 'p1', orbital_slot: 2, planet_type: 'rocky', supports_life: false, name: 'One', moons: [] }],
    asteroidBelts: [],
  })),
}))

import { createProjectorBase, galaxyAnimationSystem } from '../src/galaxyMap'
import { renderSystemView, systemViewAnimationSystem } from '../src/systemView'

const run = (system: (dt: number) => void, seconds: number) => { for (let i = 0; i < seconds * 60; i++) system(1 / 60) }
afterEach(() => { vi.restoreAllMocks() })

it("the system view's star glow pulses without re-setting its material", async () => {
  await renderSystemView('s1')
  const materials = vi.spyOn(Material, 'setPbrMaterial')
  run(systemViewAnimationSystem, 5)
  expect(materials).not.toHaveBeenCalled()   // was 300 in these 5 s
})

it('the hologram beam writes its materials a few times a second from a small set of looks', () => {
  createProjectorBase()
  run(galaxyAnimationSystem, 15)
  const materials = vi.spyOn(Material, 'setPbrMaterial')
  run(galaxyAnimationSystem, 10)
  expect(materials.mock.calls.length).toBeLessThan(10 * 12 * 2)
  const looks = new Set(materials.mock.calls.map(c => JSON.stringify((c[1] as any).albedoColor)))
  expect(looks.size).toBeLessThanOrEqual(2 * 11)
})
