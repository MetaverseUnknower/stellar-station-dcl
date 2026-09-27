// Ship Services wing: the ship scene's two desks, copied unchanged (stations.ts, stations/*), in pod 0:
// the ship desk (Overview, Ship Systems, Pod Operations) and Flora Collections (Summary, Catalog, Vault, Inventory). Only docking.ts, cabinDim.ts, soundtrack.ts and systemView.ts are
// stand-ins for ship-only systems, and the desk's HUD dialogs are in shipDialogs.tsx.
import { engine } from '@dcl/sdk/ecs'
import { Vector3 } from '@dcl/sdk/math'
import { createStation } from './stations'
import { shipOverviewView } from './stations/shipOverview'
import { shipSystemsView } from './stations/shipSystems'
import { podOperationsView } from './stations/podOperations'
import { summaryView, inventoryView } from './stations/floraCollections'
import { catalogView, vaultView } from './stations/floraSpecies'
import { showNotification, updateNotification } from './shipDialogs'
import { onGateChanged } from './gate'
import { podCenter, podOutward } from './station'

export const SHIP_SERVICES_POD = 0
const FROM_POD_CENTER = 6.5 // on the pod's outer side, past its projector
// As in the ship (index.ts): the desks stand 10.8 m apart, each turned 58 degrees in from facing straight out, Flora
// Collections on the right and the ship desk on the left as you walk up to them.
const HALF_SPACING = 5.4
const TURN_IN = 58

export function buildShipServices(): void {
  const out = podOutward(SHIP_SERVICES_POD)
  const center = podCenter(SHIP_SERVICES_POD)
  const base = Vector3.create(center.x + out.x * FROM_POD_CENTER, center.y, center.z + out.z * FROM_POD_CENTER)
  // Walking out toward the desks you face `out`; your right is (out.z, -out.x) (DCL is left-handed, y up).
  const right = Vector3.create(out.z, 0, -out.x)
  const turn = (TURN_IN * Math.PI) / 180
  const place = (side: number) => {
    // Straight back toward the hub, turned in toward the middle of the pair.
    const fx = -out.x * Math.cos(turn) - side * right.x * Math.sin(turn)
    const fz = -out.z * Math.cos(turn) - side * right.z * Math.sin(turn)
    return {
      position: Vector3.create(base.x + side * right.x * HALF_SPACING, base.y, base.z + side * right.z * HALF_SPACING),
      // A desk's front faces (sin yaw, cos yaw), as in the ship's placements.
      yaw: (Math.atan2(fx, fz) * 180) / Math.PI
    }
  }
  const flora = createStation({ id: 'flora', ...place(1), views: [summaryView, catalogView, vaultView, inventoryView], notify: showNotification })
  const ship = createStation({ id: 'ship', ...place(-1), views: [shipOverviewView, shipSystemsView, podOperationsView], notify: showNotification })
  // The desks read the player's ship, so load them once signed in and whenever the gate's answer changes
  // (docked or not decides instant installs).
  onGateChanged((gate) => {
    if (gate.kind === 'aboard') void Promise.all([flora.refresh(), ship.refresh()])
  })
  engine.addSystem((dt) => updateNotification(dt))
}
