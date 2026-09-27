// Stand-in for the ship scene's docking.ts, for the Ship Services desk copied from the ship
// (stations/shipSystems.ts). Aboard the station the ship is docked, so installs are instant, as on the ship;
// an admin visiting without being docked sees field installs, which is what the server will do for them.
import { isShipDocked } from './gate'

export function isDocked(): boolean { return isShipDocked() }
// The ship only knows the name for a dock made this session; the server's status carries no name, so this matches
// the ship after a reload ("INSTANT: SERVICE CREW").
export function dockedStationName(): string | null { return null }
