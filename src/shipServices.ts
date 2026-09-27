// Ship Services: the ship scene's two desks, copied unchanged (stations.ts, stations/*): the ship desk (Overview,
// Ship Systems, Pod Operations) and Flora Collections (Summary, Catalog, Vault, Inventory). Every pod has the pair,
// but only one pair is live: the copied code refreshes desks by id ('ship', 'flora'), so there is one live desk of
// each, and it moves to whichever pod the player is in (their home pod on arrival). The other pods show the desk
// models with dark screens. Only docking.ts, cabinDim.ts, soundtrack.ts and systemView.ts are stand-ins for
// ship-only systems, and the desk's HUD dialogs are in shipDialogs.tsx.
import { engine, Entity, Transform, GltfContainer, ColliderLayer } from '@dcl/sdk/ecs'
import { Vector3, Quaternion } from '@dcl/sdk/math'
import { getPlayer } from '@dcl/sdk/players'
import { createStation, Station } from './stations'
import { shipOverviewView } from './stations/shipOverview'
import { shipSystemsView } from './stations/shipSystems'
import { podOperationsView } from './stations/podOperations'
import { summaryView, inventoryView } from './stations/floraCollections'
import { catalogView, vaultView } from './stations/floraSpecies'
import { showNotification, updateNotification } from './shipDialogs'
import { onGateChanged, getGateState } from './gate'
import { podCenter, podOutward, podForWallet, FLOOR_Y } from './station'

const PODS = 4
const FROM_POD_CENTER = 6.5 // on the pod's outer side, past its projector
// As in the ship (index.ts): the desks stand 10.8 m apart, each turned 58 degrees in from facing straight out, Flora
// Collections on the right and the ship desk on the left as you walk up to them.
const HALF_SPACING = 5.4
const TURN_IN = 58
const IN_POD = 17 // metres from a pod's centre that count as being in it (its wall is ~15.4 m out)

type Placement = { position: Vector3; yaw: number }

/** Where pod `p`'s Flora Collections (side +1) and ship desk (side -1) stand. */
function placement(p: number, side: number): Placement {
  const out = podOutward(p)
  const center = podCenter(p)
  const base = Vector3.create(center.x + out.x * FROM_POD_CENTER, center.y, center.z + out.z * FROM_POD_CENTER)
  // Walking out toward the desks you face `out`; your right is (out.z, -out.x) (DCL is left-handed, y up).
  const right = Vector3.create(out.z, 0, -out.x)
  const turn = (TURN_IN * Math.PI) / 180
  // Straight back toward the hub, turned in toward the middle of the pair.
  const fx = -out.x * Math.cos(turn) - side * right.x * Math.sin(turn)
  const fz = -out.z * Math.cos(turn) - side * right.z * Math.sin(turn)
  return {
    position: Vector3.create(base.x + side * right.x * HALF_SPACING, base.y, base.z + side * right.z * HALF_SPACING),
    // A desk's front faces (sin yaw, cos yaw), as in the ship's placements.
    yaw: (Math.atan2(fx, fz) * 180) / Math.PI
  }
}

/** The desk models alone (no screens), placed exactly as createStation places them. */
function deskModels(at: Placement): Entity[] {
  const rotation = Quaternion.fromEulerDegrees(180, at.yaw, 180)
  return ['assets/models/nav_panel_high_1.glb', 'assets/models/nav_panel_low_1.glb'].map((src) => {
    const e = engine.addEntity()
    Transform.create(e, { position: at.position, rotation })
    GltfContainer.create(e, { src, visibleMeshesCollisionMask: ColliderLayer.CL_PHYSICS })
    return e
  })
}

export function buildShipServices(): void {
  // Dark desks in every pod; the live pair replaces them in the player's pod.
  const models: Entity[][] = []
  for (let p = 0; p < PODS; p++) models.push([...deskModels(placement(p, 1)), ...deskModels(placement(p, -1))])

  let live: { pod: number; flora: Station; ship: Station } | null = null
  const goLive = (pod: number) => {
    if (live?.pod === pod) return
    if (live) {
      live.flora.destroy()
      live.ship.destroy()
      models[live.pod] = [...deskModels(placement(live.pod, 1)), ...deskModels(placement(live.pod, -1))]
    }
    for (const e of models[pod]) engine.removeEntity(e)
    models[pod] = []
    const flora = createStation({ id: 'flora', ...placement(pod, 1), views: [summaryView, catalogView, vaultView, inventoryView], notify: showNotification })
    const ship = createStation({ id: 'ship', ...placement(pod, -1), views: [shipOverviewView, shipSystemsView, podOperationsView], notify: showNotification })
    live = { pod, flora, ship }
    if (getGateState().kind === 'aboard') void Promise.all([flora.refresh(), ship.refresh()])
  }

  // The desks read the player's ship, so load them once signed in and whenever the gate's answer changes
  // (docked or not decides instant installs). Start in the player's home pod.
  onGateChanged((gate) => {
    if (gate.kind !== 'aboard') return
    const wallet = getPlayer()?.userId
    if (!live && wallet) goLive(podForWallet(wallet))
    else if (live) void Promise.all([live.flora.refresh(), live.ship.refresh()])
  })

  // Follow the player into whichever pod they walk into.
  let timer = 0
  engine.addSystem((dt) => {
    updateNotification(dt)
    timer += dt
    if (timer < 0.5) return
    timer = 0
    if (getGateState().kind !== 'aboard') return
    const player = Transform.getOrNull(engine.PlayerEntity)
    if (!player || Math.abs(player.position.y - FLOOR_Y) > 6) return
    for (let p = 0; p < PODS; p++) {
      const c = podCenter(p)
      if (Math.hypot(player.position.x - c.x, player.position.z - c.z) < IN_POD) {
        goLive(p)
        return
      }
    }
  })
}
