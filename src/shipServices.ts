// Ship Services: the ship scene's two desks, copied unchanged (stations.ts, stations/*): the ship desk (Overview,
// Ship Systems, Pod Operations) and Flora Collections (Summary, Catalog, Vault, Inventory), and the ship's 3D system
// map (systemView.ts, unchanged) over the pod's projector. Every pod has the pair,
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
import * as api from './api'
import { renderSystemView, systemViewAnimationSystem, getSystemRoot, getSystemAutoScale } from './systemView'
import { podCenter, podOutward, podForWallet, FLOOR_Y } from './station'

const PODS = 4
// The desks flank each pod's engine hatch (the round "airlock" on the pod's wall, ~16 m from its centre), 11 m out
// and 40 degrees either side of it, facing the pod's centre: Flora Collections on the right as you face the hatch,
// the ship desk on the left. The explorer turns the kit's Blender axes half round (Blender +Y, the window, is -Z in
// the scene: the ship scene's window glass is south of its centre), which puts the hatch 90 degrees clockwise (seen
// from above) from the pod's outward direction.
const DESK_RADIUS = 11
const DESK_SPREAD = 40 // degrees either side of the hatch
const IN_POD = 17 // metres from a pod's centre that count as being in it (its wall is ~15.4 m out)
// The ship's 3D system map (systemView.ts, copied unchanged) floats over the pod's projector, as over the ship's.
const MAP_ABOVE_FLOOR = 2.1 // the ship's SYSTEM_CENTER is 2.1 m above its deck
const MAP_SCALE = 0.75 // of the ship's size: keeps it within ~6 m of the projector, clear of the spawn and desks

type Placement = { position: Vector3; yaw: number }

/** Where pod `p`'s Flora Collections (side +1) and ship desk (side -1) stand. */
function placement(p: number, side: number): Placement {
  const out = podOutward(p)
  const center = podCenter(p)
  const hatch = Vector3.create(out.z, 0, -out.x) // out turned 90 degrees clockwise from above
  const right = Vector3.create(hatch.z, 0, -hatch.x) // facing the hatch, your right (DCL is left-handed, y up)
  const a = (DESK_SPREAD * Math.PI) / 180
  const dir = Vector3.create(hatch.x * Math.cos(a) + side * right.x * Math.sin(a), 0, hatch.z * Math.cos(a) + side * right.z * Math.sin(a))
  return {
    position: Vector3.create(center.x + dir.x * DESK_RADIUS, center.y, center.z + dir.z * DESK_RADIUS),
    // Facing the pod's centre; a desk's front faces (sin yaw, cos yaw), as in the ship's placements.
    yaw: (Math.atan2(-dir.x, -dir.z) * 180) / Math.PI
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
    placeSystemMap()
  }

  // One system map, like the one pair of live desks: shown over the projector of the pod you're in.
  let mapRendered = false
  const placeSystemMap = () => {
    const root = getSystemRoot()
    if (!live || !root) return
    const c = podCenter(live.pod)
    const t = Transform.getMutable(root)
    t.position = Vector3.create(c.x, FLOOR_Y + MAP_ABOVE_FLOOR, c.z)
    const s = getSystemAutoScale() * MAP_SCALE
    t.scale = Vector3.create(s, s, s)
  }
  const showSystemMap = async () => {
    if (mapRendered) return
    mapRendered = true
    try {
      const me = await api.getPlayerMe()
      if (me?.current_system_id) {
        await renderSystemView(me.current_system_id)
        placeSystemMap()
      }
    } catch (err) {
      mapRendered = false
      console.log('[ship services] system map failed', err)
    }
  }
  engine.addSystem(systemViewAnimationSystem)

  // The desks read the player's ship, so load them once signed in and whenever the gate's answer changes
  // (docked or not decides instant installs). Start in the player's home pod.
  onGateChanged((gate) => {
    if (gate.kind !== 'aboard') return
    const wallet = getPlayer()?.userId
    if (!live && wallet) goLive(podForWallet(wallet))
    else if (live) void Promise.all([live.flora.refresh(), live.ship.refresh()])
    void showSystemMap()
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
