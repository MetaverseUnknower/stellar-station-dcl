// The way home: each docking pod's airlock (its round engine hatch, the "airlock" of the kit, on the pod's wall).
// Walk up to it and a prompt offers E to return to your ship. Marked by a glowing ring on the floor in front of the
// hatch and an AIRLOCK label over it. (Admins also keep a button in the crew panel, ui.tsx.)
//
// Where: each pod's hatch is 90 degrees clockwise (seen from above) from the pod's outward direction, ~16 m from its
// centre (shipServices.ts places the ship desks either side of it); the ring is at WALK_UP metres, on the deck.
import { engine, Transform, MeshRenderer, Material, TextShape, inputSystem, InputAction, PointerEventType, MaterialTransparencyMode } from '@dcl/sdk/ecs'
import { Vector3, Quaternion, Color3, Color4 } from '@dcl/sdk/math'
import { podCenter, podOutward, FLOOR_Y } from './station'
import { returnToShip } from './gate'

const WALK_UP = 13.2 // metres from the pod's centre toward its hatch: the ring's centre
const REACH = 2.2 // metres round the ring's centre that count as "at the airlock"
const LABEL_R = 14.6 // the AIRLOCK label, over the hatch
const PODS = 4
const GLOW = Color3.create(0, 0.9, 1)

let atAirlock = false
/** Whether the player is standing at an airlock (the HUD shows the prompt). */
export const standingAtAirlock = () => atAirlock

function hatchDirection(p: number): Vector3 {
  const out = podOutward(p)
  return Vector3.create(out.z, 0, -out.x) // out turned 90 degrees clockwise from above, as in shipServices.ts
}

export function buildAirlocks(): void {
  const spots: Vector3[] = []
  for (let p = 0; p < PODS; p++) {
    const c = podCenter(p)
    const h = hatchDirection(p)
    const spot = Vector3.create(c.x + h.x * WALK_UP, FLOOR_Y, c.z + h.z * WALK_UP)
    spots.push(spot)

    // A glowing ring on the deck: a thin flat disc under a slightly smaller dark one.
    const ring = engine.addEntity()
    Transform.create(ring, { position: Vector3.create(spot.x, FLOOR_Y + 0.02, spot.z), scale: Vector3.create(REACH * 1.6, 0.01, REACH * 1.6) })
    MeshRenderer.setCylinder(ring)
    Material.setPbrMaterial(ring, {
      albedoColor: Color4.create(0, 0.9, 1, 0.35),
      emissiveColor: GLOW,
      emissiveIntensity: 1.2,
      transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND,
      castShadows: false
    })
    const inner = engine.addEntity()
    Transform.create(inner, { position: Vector3.create(spot.x, FLOOR_Y + 0.025, spot.z), scale: Vector3.create(REACH * 1.45, 0.01, REACH * 1.45) })
    MeshRenderer.setCylinder(inner)
    Material.setPbrMaterial(inner, { albedoColor: Color4.create(0.02, 0.05, 0.1, 0.8), transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND, castShadows: false })

    // AIRLOCK over the hatch, read from the pod (text reads from its -Z side, so +Z points at the hatch).
    const label = engine.addEntity()
    Transform.create(label, {
      position: Vector3.create(c.x + h.x * LABEL_R, FLOOR_Y + 4.2, c.z + h.z * LABEL_R),
      rotation: Quaternion.fromEulerDegrees(0, (Math.atan2(h.x, h.z) * 180) / Math.PI, 0)
    })
    TextShape.create(label, { text: 'AIRLOCK\n<size=55%>RETURN TO SHIP</size>', fontSize: 2.4, textColor: Color4.create(0.6, 0.95, 1, 1), outlineWidth: 0.1, outlineColor: Color3.Black() })
  }

  engine.addSystem(() => {
    const me = Transform.getOrNull(engine.PlayerEntity)
    if (!me) return
    const onDeck = Math.abs(me.position.y - FLOOR_Y) < 1.5
    atAirlock = onDeck && spots.some((s) => Math.hypot(me.position.x - s.x, me.position.z - s.z) < REACH)
    if (atAirlock && inputSystem.isTriggered(InputAction.IA_PRIMARY, PointerEventType.PET_DOWN)) {
      returnToShip('Cycling the airlock. Returning to your ship.')
    }
  })
}
