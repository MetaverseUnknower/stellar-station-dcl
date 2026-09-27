// Ship Services wing: the ship scene's ship desk (Overview, Ship Systems, Pod Operations), copied unchanged
// (stations.ts, stations/*), in pod 0. Only docking.ts, cabinDim.ts, soundtrack.ts and systemView.ts are
// stand-ins for ship-only systems, and the desk's HUD dialogs are in shipDialogs.tsx.
import { engine } from '@dcl/sdk/ecs'
import { Vector3 } from '@dcl/sdk/math'
import { createStation } from './stations'
import { shipOverviewView } from './stations/shipOverview'
import { shipSystemsView } from './stations/shipSystems'
import { podOperationsView } from './stations/podOperations'
import { showNotification, updateNotification } from './shipDialogs'
import { onGateChanged } from './gate'
import { podCenter, podOutward } from './station'

export const SHIP_SERVICES_POD = 0
const FROM_POD_CENTER = 6.5 // on the pod's outer side, past its projector, facing back toward the door

export function buildShipServices(): void {
  const out = podOutward(SHIP_SERVICES_POD)
  const center = podCenter(SHIP_SERVICES_POD)
  // A desk's front faces (sin yaw, cos yaw) (see the ship's index.ts placements); face back toward the hub.
  const yaw = (Math.atan2(-out.x, -out.z) * 180) / Math.PI
  const desk = createStation({
    id: 'ship',
    position: Vector3.create(center.x + out.x * FROM_POD_CENTER, center.y, center.z + out.z * FROM_POD_CENTER),
    yaw,
    views: [shipOverviewView, shipSystemsView, podOperationsView],
    notify: showNotification
  })
  // The desk reads the player's ship, so load it once signed in and whenever the gate's answer changes
  // (docked or not decides instant installs).
  onGateChanged((gate) => {
    if (gate.kind === 'aboard') void desk.refresh()
  })
  engine.addSystem((dt) => updateNotification(dt))
}
