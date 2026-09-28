// Galaxy Gardeners — Fuel drop state for the scene: the live scene drop, claim/redeem actions, and player copy.
import { getSceneDrop, claimSceneDrop, redeemFuelCode, type SceneDrop, type DropResult } from './api'

let liveDrop: SceneDrop | null = null
let claimed = false
// Server-side on/off switch for the dispenser; reported by GET /api/drops/scene and by 'dispenser_off' results
let dispenserEnabled = true

/** Shown by the panel's own register gate for 'new' players — kept distinct from the server's no_ship copy. */
export const REGISTER_FIRST = 'Register with FERN first to get a ship.'
export const DISPENSER_CLOSED = 'The dispenser is closed right now.'

export function getLiveSceneDrop(): SceneDrop | null {
  return liveDrop
}

export function isDispenserEnabled(): boolean {
  return dispenserEnabled
}

export function setDispenserEnabledState(enabled: boolean): void {
  dispenserEnabled = enabled
}

export function hasUnclaimedSceneDrop(): boolean {
  return liveDrop !== null && !claimed
}

/** Refresh from the server. On failure keep the last known state and return false. */
export async function refreshSceneDrop(): Promise<boolean> {
  try {
    const res = await getSceneDrop()
    liveDrop = res.drop
    claimed = res.claimed
    if (typeof res.dispenserEnabled === 'boolean') dispenserEnabled = res.dispenserEnabled
    return true
  } catch (e) {
    console.log('[fuel] scene drop lookup failed:', e)
    return false
  }
}

export async function claimLiveSceneDrop(): Promise<DropResult> {
  if (!liveDrop) return { status: 'expired' }
  try {
    const result = await claimSceneDrop(liveDrop.id)
    if (result.status === 'dispenser_off') dispenserEnabled = false
    else if (result.status === 'ok' || result.status === 'already_claimed') claimed = true
    else if (result.status === 'expired' || result.status === 'sold_out' || result.status === 'not_found') liveDrop = null
    return result
  } catch (e) {
    console.log('[fuel] claim failed:', e)
    return { status: 'error' }
  }
}

export async function redeemCode(raw: string): Promise<DropResult> {
  const code = raw.trim()
  if (!code) return { status: 'not_found' }
  try {
    const result = await redeemFuelCode(code)
    if (result.status === 'dispenser_off') dispenserEnabled = false
    return result
  } catch (e) {
    console.log('[fuel] redeem failed:', e)
    return { status: 'error' }
  }
}

export function describeResult(result: DropResult): string {
  switch (result.status) {
    case 'ok': {
      const cells = result.cells ?? 0
      return `Dispensed ${cells} Fuel Cell${cells === 1 ? '' : 's'}! Your ship now holds ${result.fuelCells ?? cells}.`
    }
    case 'already_claimed':
      return "You've already claimed this one."
    case 'sold_out':
      return 'All claimed. Watch for the next drop!'
    case 'expired':
    case 'not_started':
    case 'not_found':
      return "That offer isn't active right now."
    case 'ineligible':
      return 'This drop is for pilots who were already flying before it started.'
    case 'no_ship':
      return "Your ship isn't ready yet. Try again soon."
    case 'guest':
      return 'Connect a wallet to claim fuel.'
    case 'unauthorized':
      return "Couldn't verify your wallet. Try re-entering the scene."
    case 'rate_limited':
      return 'Too many tries. Wait a minute and try again.'
    case 'dispenser_off':
      return DISPENSER_CLOSED
    default:
      return 'The dispenser is offline right now. Try again soon.'
  }
}
