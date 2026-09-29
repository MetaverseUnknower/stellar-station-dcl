// The lounge's show (dance floor and club rig) runs only while the player is up in the lounge: away from it, it
// wrote thousands of materials, lights and transforms a second, unseen, all session.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Material, LightSource, Transform } from '@dcl/sdk/ecs'
import { tick } from './helpers'

const beatListeners: ((beat: number) => void)[] = []
let fade = 0
vi.mock('../src/lounge/beatClock', () => ({
  onBeat: (fn: (b: number) => void) => { beatListeners.push(fn) },
  beatLevel: () => 0.5, midLevel: () => 0.5, highLevel: () => 0.5, beatCount: () => 0,
  startBeatClock: () => {}, isLiveAnalysis: () => false,
}))
vi.mock('../src/lounge/music', () => ({ loungeFade: () => fade, loungeSpeaker: () => null }))

import { buildHubLevels } from '../src/hubLevels'
import { buildClubLights } from '../src/lounge/clubLights'

const beats = (n: number) => { for (let i = 0; i < n; i++) for (const fn of beatListeners) fn(i) }
beforeEach(() => { fade = 0 })
afterEach(() => { vi.restoreAllMocks() })

describe('dance floor', () => {
  it('only paints while the player is in the lounge', async () => {
    buildHubLevels()
    await tick(0.5)   // the hub's one-off build writes
    const materials = vi.spyOn(Material, 'setPbrMaterial')
    fade = 0
    beats(8); await tick(2)
    expect(materials).not.toHaveBeenCalled()   // was 208 tiles x 2 a beat
    fade = 1
    beats(2); await tick(1)
    expect(materials.mock.calls.length).toBeGreaterThan(0)
  })
})

describe('club rig', () => {
  it('does nothing away from the lounge after switching the spots off once, and runs again on return', async () => {
    buildClubLights()
    fade = 1
    await tick(1)
    fade = 0
    await tick(0.1)   // the one last write: spots off
    const lights = vi.spyOn(LightSource, 'getMutable')
    const materials = vi.spyOn(Material, 'setPbrMaterial')
    const transforms = vi.spyOn(Transform, 'getMutable')
    beats(8); await tick(5)
    expect(lights).not.toHaveBeenCalled()
    expect(materials).not.toHaveBeenCalled()
    expect(transforms).not.toHaveBeenCalled()   // was ~3,000 writes a second
    fade = 1
    await tick(0.5)
    expect(transforms.mock.calls.length).toBeGreaterThan(0)
  })
})
