// Requirement 1: only players whose ship is docked may be aboard. A world can't refuse entry, so the scene
// signs the player in, asks the server, and sends anyone not docked back to the ship world. The check repeats,
// since a player can undock from the iOS app while standing here.
// Admins (is_admin on the server) are always let in, for debugging: at their docked station if they have one,
// otherwise at the first station, and they can switch to any station from the admin panel (pickStation).
import { engine } from '@dcl/sdk/ecs'
import { changeRealm } from '~system/RestrictedActions'
import { getRealm } from '~system/Runtime'
import { authenticate } from './auth'
import { getStationStatus, listStations, StationSummary } from './stationApi'

export const SHIP_WORLD = 'galaxygardeners.dcl.eth'
const RECHECK_SECONDS = 30

export type GateState =
  | { kind: 'checking' }
  | { kind: 'aboard'; stationId: string }
  | { kind: 'refused'; reason: string; newcomer?: boolean }   // newcomer: no Galaxy Gardeners captain yet
  | { kind: 'error'; reason: string }

let state: GateState = { kind: 'checking' }
// In a local preview nobody is a docked captain, so the gate reports but doesn't send anyone away.
let preview = false
const listeners: ((s: GateState) => void)[] = []
let admin = false
let shipDocked = false
let stations: StationSummary[] = []
let adminPick: string | null = null

export function getGateState(): GateState { return state }
export function isPreview(): boolean { return preview }
export function isAdmin(): boolean { return admin }
/** The player's ship is docked (an admin can be aboard without it). */
export function isShipDocked(): boolean { return shipDocked }
export function getStations(): StationSummary[] { return stations }

/** Admin only: switch to another station's audience. */
export function pickStation(stationId: string): void {
  if (!admin) return
  adminPick = stationId
  set({ kind: 'aboard', stationId })
}
export function onGateChanged(fn: (s: GateState) => void): void { listeners.push(fn) }

function set(next: GateState): void {
  const same = next.kind === state.kind && (next.kind !== 'aboard' || state.kind !== 'aboard' || next.stationId === state.stationId)
  state = next
  if (!same) for (const fn of listeners) fn(state)
}

/** Sends a player who isn't allowed aboard back to the ship, except in preview. */
function eject(message: string): void {
  if (preview) console.log('[gate] preview: would return to ship:', message)
  else returnToShip(message)
}

export function returnToShip(message: string): void {
  void changeRealm({ realm: SHIP_WORLD, message }).catch((err) => console.log('[gate] changeRealm failed', err))
}

async function check(): Promise<void> {
  try {
    const status = await getStationStatus()
    shipDocked = status.isDocked
    if (status.isAdmin) {
      admin = true
      if (!stations.length) stations = await listStations().catch(() => [])
      const stationId = adminPick ?? status.stationId ?? stations[0]?.id
      if (stationId) {
        set({ kind: 'aboard', stationId })
        return
      }
    }
    if (status.isDocked && status.stationId) {
      set({ kind: 'aboard', stationId: status.stationId })
      return
    }
    const wasAboard = state.kind === 'aboard'
    set({ kind: 'refused', reason: wasAboard ? 'Your ship has undocked from the station.' : 'Your ship is not docked at a station.' })
    eject(
      wasAboard
        ? 'Your ship has undocked. Head back aboard before the airlock seals.'
        : 'Stellar Station is only open to crews whose ship is docked. Dock at a station from your ship first.'
    )
  } catch (err: any) {
    // A failed check keeps the current state: a network blip shouldn't throw a docked player out.
    console.log('[gate] status check failed', err?.message ?? err)
    if (state.kind === 'checking') set({ kind: 'error', reason: 'Could not reach the station registry. Retrying...' })
  }
}

export async function startGate(): Promise<void> {
  try {
    preview = !!(await getRealm({})).realmInfo?.isPreview
  } catch {
    /* not a preview */
  }
  try {
    // A sign-in that never answers would leave the player waiting in the airlock with no word; give up after 20 s
    // and say so (the checks below keep retrying).
    const { hasPlayer } = await Promise.race([
      authenticate(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('sign-in timed out')), 20000))
    ])
    if (!hasPlayer) {
      // A first-time visitor: the game starts in the ship world, where their ship is waiting to be claimed
      set({ kind: 'refused', reason: 'Only docked Galaxy Gardeners crews can come aboard.', newcomer: true })
      eject(`Welcome! Stellar Station is for Galaxy Gardeners crews. Claim your free ship at ${SHIP_WORLD}, then dock at a station to come aboard.`)
      return
    }
  } catch (err: any) {
    console.log('[gate] sign-in failed', err?.message ?? err)
    set({ kind: 'error', reason: 'Could not sign in to Galaxy Gardeners. Retrying...' })
  }

  await check()
  let timer = 0
  engine.addSystem((dt) => {
    // While refused we still re-check, so a player who declined the realm prompt gets asked again.
    timer += dt
    if (timer < (state.kind === 'aboard' ? RECHECK_SECONDS : 10)) return
    timer = 0
    void check()
  })
}
