// The breeding lab: a pod off the Docks (build_station_models.py LAB_*), built but sealed until flower breeding
// comes to the stations. Its corridor is closed at the hub end by a door (sealed_door there); here, the lettering on
// the door, and a soft pulse on it to say something's behind it.
//
// Model to scene: a Blender angle A round the hub is scene angle A + 180 (see arcade.ts).
import { engine, Transform, TextShape } from '@dcl/sdk/ecs'
import { Vector3, Quaternion, Color3, Color4 } from '@dcl/sdk/math'
import { CENTER, FLOOR_Y } from '../station'

const LAB_ANGLE = 169.5 + 180 // build_station_models.py LAB_ANGLE, in scene degrees (from +X toward +Z)
const DOOR_FACE = 33.439 // the door's hub side, metres out (the build prints it: SEALED LabDoor)
const PROUD = 0.03 // the lettering stands this far in front of the door

export function buildLab(): void {
  const a = (LAB_ANGLE * Math.PI) / 180
  const r = DOOR_FACE - PROUD
  // Text reads from its -Z side: +Z points out, away from the hub's centre.
  const rotation = Quaternion.fromEulerDegrees(0, (Math.atan2(Math.cos(a), Math.sin(a)) * 180) / Math.PI, 0)
  const spot = (h: number) => Vector3.create(CENTER.x + Math.cos(a) * r, FLOOR_Y + h, CENTER.z + Math.sin(a) * r)

  const title = engine.addEntity()
  Transform.create(title, { position: spot(2.55), rotation })
  TextShape.create(title, { text: 'BREEDING LAB', fontSize: 3.2, textColor: Color4.create(0.85, 0.7, 1, 1), outlineWidth: 0.12, outlineColor: Color3.Black() })

  const soon = engine.addEntity()
  Transform.create(soon, { position: spot(2.05), rotation })
  TextShape.create(soon, { text: 'SEALED  ·  COMING SOON', fontSize: 1.6, textColor: Color4.create(1, 0.7, 0.3, 1), outlineWidth: 0.12, outlineColor: Color3.Black() })

  // The "coming soon" line breathes, slowly.
  let t = 0
  let lastK = -1
  engine.addSystem((dt) => {
    t += dt
    // In 12 steps, written only when the step changes: the whole TextShape is re-sent on every write
    const k = Math.round((0.55 + 0.45 * (0.5 + 0.5 * Math.sin(t * 1.6))) * 12) / 12
    if (k === lastK) return
    lastK = k
    TextShape.getMutable(soon).textColor = Color4.create(1 * k, 0.7 * k, 0.3 * k, 1)
  })
}
