// Stellar Station: the scene players move to while their ship is docked at a Galaxy Gardeners station.
// See HANDOFF.md for the requirements: docked players only, per-station audience, transfer to and from the ship.
import { buildStation } from './station'
import { startGate } from './gate'
import { startAudienceFilter } from './audience'
import { setupUi } from './ui'

export function main() {
  buildStation()

  // Hide everyone first, then open the gate; the filter follows the gate's station.
  startAudienceFilter()
  setupUi()
  void startGate()
}
