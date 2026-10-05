// Desk buttons and panels catch the pointer only. A collider with no layer is solid too (the SDK's default is
// CL_POINTER | CL_PHYSICS), so every redraw dropped solid boxes where the captain stood and the engine shoved them
// clear (the ship scene's Skat report, Oct 5 2026; this desk code is the same).
import { describe, it, expect } from 'vitest'
import { engine, MeshCollider, ColliderLayer } from '@dcl/sdk/ecs'
import { clickable } from '../src/stations/draw'

describe('clickable desk elements', () => {
  it('catch clicks without being solid', () => {
    const e = engine.addEntity()
    clickable(e, 'Dock', () => {})
    expect(MeshCollider.get(e).collisionMask).toBe(ColliderLayer.CL_POINTER)
  })
})
