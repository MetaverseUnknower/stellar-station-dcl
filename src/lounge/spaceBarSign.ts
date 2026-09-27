// The "SPACE BAR" neon sign (space_bar_sign.glb, from tools/build_space_bar_sign.py) on the lounge wall, tipped back
// to lie along the dome, which curves inward there (~41 degrees from vertical between 3 and 6 m above the lounge
// floor), so it faces down across the dance floor, 0.45 m off the wall.
//
// Where: 230 degrees round from +X (toward +Z). A scan of the whole lounge wall (sign on the dome, sight lines from
// its face to eye height on the dance floor) found this stretch clear: between a corridor doorway below and the start
// of the big window, off the pillars that stand proud of the dome. The first spot, over the east lift, had half its
// sight lines blocked by one of them.
import { engine, Transform, GltfContainer } from '@dcl/sdk/ecs'
import { Vector3, Quaternion } from '@dcl/sdk/math'
import { CENTER, FLOOR_Y } from '../station'

const ANGLE = 230 // degrees from +X toward +Z
const CENTRE_RADIUS = 25.86 // out from the hub's centre: the dome (26.2 m at this height) less 0.45 m along its normal
const CENTRE_HEIGHT = 28.51 // above the deck (the lounge floor is at 25)
const TILT = 41 // degrees: the dome's slope here (26.9 m out at 28 m up, 24.3 m at 31 m up)

export function buildSpaceBarSign(): void {
  const a = (ANGLE * Math.PI) / 180
  const sign = engine.addEntity()
  Transform.create(sign, {
    position: Vector3.create(CENTER.x + Math.cos(a) * CENTRE_RADIUS, FLOOR_Y + CENTRE_HEIGHT, CENTER.z + Math.sin(a) * CENTRE_RADIUS),
    // The model faces +Z: tip its face down by TILT, then turn it to face the centre. A yaw turns +Z toward +X, so
    // facing (-cos a, -sin a) is a yaw of atan2(-cos a, -sin a).
    rotation: Quaternion.fromEulerDegrees(TILT, (Math.atan2(-Math.cos(a), -Math.sin(a)) * 180) / Math.PI, 0)
  })
  GltfContainer.create(sign, { src: 'assets/models/space_bar_sign.glb' })
}
