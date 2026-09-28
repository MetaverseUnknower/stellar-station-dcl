// The black market's back room: a grimy lean-to on the lounge floor against the dome, past the pillar at the Space
// Bar's end (tools/build_black_market.py builds the room, its strip curtain and the terminal). Here: the models, a
// bare bulb that flickers, the lettering (STAFF ONLY over the door, a buzzing OPEN, the terminal's screen and its
// NO REFUNDS sticker), and the terminal opening the market's panel (market.ts, panelUi.tsx).
//
// Model to scene: the models are built in place round the hub's centre, so they go at the centre unturned; a point
// the build prints in Blender coordinates (x, y, z) is scene (CENTER.x - x, lounge floor + z, CENTER.z - y), and a
// Blender angle A round the hub is scene angle A + 180.
import {
  engine, Transform, GltfContainer, ColliderLayer, LightSource, TextShape, Font, TextAlignMode, pointerEventsSystem, InputAction
} from '@dcl/sdk/ecs'
import { Vector3, Quaternion, Color3, Color4 } from '@dcl/sdk/math'
import { CENTER, FLOOR_Y } from '../station'
import { openMarket, closeMarket, market } from './market'

const LOUNGE = 25 // build_station_models.py LOUNGE
const FRONT_R = 22.8 // build_black_market.py R_FRONT: the front wall's hub-side face
const DOOR_MID = 200.73 // scene degrees: the doorway's middle (the build prints DOOR scene angles 199.1 .. 202.37)
const OPEN_ANGLE = 196.2 // the OPEN sign, on the front wall left of the door (seen from the lounge)
const TERMINAL_ANGLE = 17.25 + 180 // build_black_market.py TERMINAL_A
const SCREEN = { x: 26.097, y: 8.103, z: 1.51 } // the build's SCREEN centre (Blender)
const BULB = { x: 24.669, y: 6.841, z: 2.25 } // the build's BULB (Blender)
const STICKER_R = 27.23 // the cabinet's front, 1 cm proud
const WALK_AWAY = 6 // metres from the terminal: the panel closes

// Read at call time: station.ts imports this module, so FLOOR_Y isn't set yet while this file first runs.
const floorY = () => FLOOR_Y + LOUNGE
const fromBlender = (p: { x: number; y: number; z: number }) => Vector3.create(CENTER.x - p.x, floorY() + p.z, CENTER.z - p.y)
const onRadius = (deg: number, r: number, h: number) => {
  const a = (deg * Math.PI) / 180
  return Vector3.create(CENTER.x + Math.cos(a) * r, floorY() + h, CENTER.z + Math.sin(a) * r)
}
/** Text reads from its -Z side: turn +Z to point out, away from the hub's centre, so it faces the centre. */
const facingCentre = (deg: number) => {
  const a = (deg * Math.PI) / 180
  return Quaternion.fromEulerDegrees(0, (Math.atan2(Math.cos(a), Math.sin(a)) * 180) / Math.PI, 0)
}

export function buildBlackMarket(): void {
  const place = (src: string, mask: number) => {
    const e = engine.addEntity()
    Transform.create(e, { position: Vector3.create(CENTER.x, floorY(), CENTER.z) })
    GltfContainer.create(e, { src, visibleMeshesCollisionMask: mask, invisibleMeshesCollisionMask: ColliderLayer.CL_NONE })
    return e
  }
  place('assets/models/black_market_room.glb', ColliderLayer.CL_PHYSICS)
  place('assets/models/black_market_curtain.glb', ColliderLayer.CL_NONE)
  const terminal = place('assets/models/black_market_terminal.glb', ColliderLayer.CL_PHYSICS | ColliderLayer.CL_POINTER)
  pointerEventsSystem.onPointerDown(
    { entity: terminal, opts: { button: InputAction.IA_POINTER, hoverText: 'Black Market', maxDistance: 4 } },
    () => void openMarket()
  )

  // STAFF ONLY over the door, stencilled
  const staff = engine.addEntity()
  Transform.create(staff, { position: onRadius(DOOR_MID, FRONT_R - 0.02, 2.72), rotation: facingCentre(DOOR_MID) })
  TextShape.create(staff, { text: 'STAFF ONLY', fontSize: 1.5, font: Font.F_MONOSPACE, textColor: Color4.create(0.75, 0.62, 0.2, 1) })

  // A buzzing OPEN, left of the door
  const open = engine.addEntity()
  Transform.create(open, { position: onRadius(OPEN_ANGLE, FRONT_R - 0.02, 1.9), rotation: facingCentre(OPEN_ANGLE) })
  TextShape.create(open, { text: 'OPEN', fontSize: 2.4, textColor: Color4.create(1, 0.2, 0.65, 1), outlineWidth: 0.2, outlineColor: Color3.create(0.5, 0.05, 0.3) })

  // The terminal's screen, and the sticker on its cabinet
  const screenPos = fromBlender(SCREEN)
  const towardCentre = Vector3.normalize(Vector3.create(CENTER.x - screenPos.x, 0, CENTER.z - screenPos.z))
  const screen = engine.addEntity()
  Transform.create(screen, { position: Vector3.add(screenPos, Vector3.scale(towardCentre, 0.02)), rotation: facingCentre(TERMINAL_ANGLE) })
  TextShape.create(screen, { text: '', fontSize: 0.9, font: Font.F_MONOSPACE, textColor: Color4.create(0.4, 1, 0.5, 1), textAlign: TextAlignMode.TAM_MIDDLE_LEFT, width: 0.55 })
  const sticker = engine.addEntity()
  Transform.create(sticker, {
    position: onRadius(TERMINAL_ANGLE + 0.4, STICKER_R, 0.72),
    rotation: Quaternion.multiply(facingCentre(TERMINAL_ANGLE), Quaternion.fromEulerDegrees(0, 0, -7))
  })
  TextShape.create(sticker, { text: 'NO REFUNDS', fontSize: 0.9, textColor: Color4.create(0.05, 0.05, 0.05, 1), outlineWidth: 0.1, outlineColor: Color3.create(0.95, 0.85, 0.2) })

  // The bare bulb: warm, and not quite right
  const bulb = engine.addEntity()
  Transform.create(bulb, { position: fromBlender(BULB) })
  LightSource.create(bulb, { type: LightSource.Type.Point({}), color: Color3.create(1, 0.6, 0.32), intensity: 1800, range: 7, shadow: true })

  const terminalPos = onRadius(TERMINAL_ANGLE, 26.8, 1)
  let t = 0
  let bulbDip = 0
  let openOff = 0
  let bulbWasDim = false
  let openWasOff = false
  engine.addSystem((dt) => {
    t += dt
    // The bulb dips now and then; the OPEN sign drops out in stutters.
    if (bulbDip > 0) bulbDip -= dt
    else if (Math.random() < dt * 0.25) bulbDip = 0.08 + Math.random() * 0.25
    if (bulbDip > 0 !== bulbWasDim) {
      bulbWasDim = bulbDip > 0
      LightSource.getMutable(bulb).intensity = bulbWasDim ? 350 : 1800
    }
    if (openOff > 0) openOff -= dt
    else if (Math.random() < dt * 0.4) openOff = 0.05 + Math.random() * 0.4
    if (openOff > 0 !== openWasOff) {
      openWasOff = openOff > 0
      const k = openWasOff ? 0.15 : 1
      TextShape.getMutable(open).textColor = Color4.create(1 * k, 0.2 * k, 0.65 * k, 1)
    }

    // The screen: a prompt with a blinking cursor, or what the panel is doing while it's open
    const cursor = Math.floor(t * 2) % 2 === 0 ? '_' : ' '
    const line = market.open ? (market.busy ? 'WORKING' : 'CONNECTED') : 'NO QUESTIONS'
    const text = `> BLACK MARKET\n> ${line}${cursor}`
    if (TextShape.get(screen).text !== text) TextShape.getMutable(screen).text = text

    // Walk away and the panel closes
    if (market.open) {
      const me = Transform.getOrNull(engine.PlayerEntity)
      if (me && Vector3.distance(me.position, terminalPos) > WALK_AWAY) closeMarket()
    }
  })
}
