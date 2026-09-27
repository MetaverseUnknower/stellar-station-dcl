// The "SPACE BAR" neon sign (space_bar_sign.glb, from tools/build_space_bar_sign.py) on the lounge wall above the
// east (+X) lift, tipped back to lie along the dome, which curves inward there (~41 degrees from vertical between
// 3 and 6 m above the lounge floor), so it faces down across the dance floor, 0.45 m off the wall.
import { engine, Transform, GltfContainer } from '@dcl/sdk/ecs'
import { Vector3, Quaternion } from '@dcl/sdk/math'
import { CENTER, FLOOR_Y } from '../station'

const CENTRE_RADIUS = 25.86 // out from the hub's centre: the dome (26.2 m at this height) less 0.45 m along its normal
const CENTRE_HEIGHT = 28.51 // above the deck (the lounge floor is at 25)
const TILT = 41 // degrees: the dome's slope here (26.9 m out at 28 m up, 24.3 m at 31 m up)

export function buildSpaceBarSign(): void {
  const sign = engine.addEntity()
  Transform.create(sign, {
    position: Vector3.create(CENTER.x + CENTRE_RADIUS, FLOOR_Y + CENTRE_HEIGHT, CENTER.z),
    // The model faces +Z: tip its face down by TILT, then turn it to face the centre (-X).
    rotation: Quaternion.fromEulerDegrees(TILT, -90, 0)
  })
  GltfContainer.create(sign, { src: 'assets/models/space_bar_sign.glb' })
}
