// Galaxy Gardeners — Fuel dispenser panel state and actions. ui.tsx renders it every frame from this object.
import { getPlayer } from '@dcl/sdk/players'
import { setDispenserEnabled, getPendingManaPurchases, type DropResult } from './api'
import { DISPENSER_OPERATORS } from './config'
import {
  payMana,
  redeemManaPurchase,
  paymentErrorMessage,
  getPendingManaPurchase,
  CONFIRM_POLL_MS,
  MANA_TIERS,
  type ManaTier
} from './payments'
import { getPlayerStatus, ensurePlayerStatus } from './playerState'
import {
  refreshSceneDrop,
  hasUnclaimedSceneDrop,
  claimLiveSceneDrop,
  redeemCode,
  describeResult,
  isDispenserEnabled,
  setDispenserEnabledState,
  REGISTER_FIRST
} from './fuelDrops'

/** Which of the giveaway/store/code screens the player has chosen. 'auto' lets the mode resolve on its own. */
export type FuelPanelView = 'auto' | 'store' | 'code'

export const fuelPanel = {
  open: false,
  /** true only while the panel is first signing in / fetching the scene drop */
  loading: false,
  /** reentrancy guard for every claim, redeem and purchase */
  busy: false,
  /** true only while checking the server for a purchase left pending by a scene reload; blocks a fresh buy
   *  without tripping the `busy` guard the recovered purchase itself needs to run */
  recovering: false,
  /** reentrancy guard for the operator on/off switch */
  toggling: false,
  code: '',
  message: '',
  needsRegistration: false,
  view: 'auto' as FuelPanelView
}

/** What the panel shows, resolved every render in this order */
export type PanelMode = 'loading' | 'register' | 'closed' | 'giveaway' | 'store' | 'code'

export function getPanelMode(): PanelMode {
  if (fuelPanel.loading) return 'loading'
  if (fuelPanel.needsRegistration) return 'register'
  if (!isDispenserEnabled()) return 'closed'
  if (fuelPanel.view === 'code') return 'code'
  if (fuelPanel.view === 'store') return 'store'
  return hasUnclaimedSceneDrop() ? 'giveaway' : 'store'
}

/** "No thanks" on the giveaway screen: skip the freebie and go straight to the store. */
export function declineGiveaway(): void {
  fuelPanel.view = 'store'
}

/** "Redeem a code" on the store screen. */
export function showCodeEntry(): void {
  fuelPanel.view = 'code'
}

/** "‹ Back" on the code screen. */
export function backToStore(): void {
  fuelPanel.view = 'store'
}

let onDispensed: (() => void) | null = null

/** vending.ts registers the capsule effect here so the panel doesn't depend on scene entities */
export function setDispenseEffect(effect: () => void): void {
  onDispensed = effect
}

/** Plays the capsule effect (after a claim, a redeemed code or a MANA purchase) */
export function playDispenseEffect(): void {
  onDispensed?.()
}

export async function openFuelPanel(): Promise<void> {
  if (fuelPanel.busy || fuelPanel.loading || fuelPanel.recovering) {
    fuelPanel.open = true
    return
  }
  fuelPanel.open = true
  fuelPanel.code = ''
  fuelPanel.message = ''
  fuelPanel.view = 'auto'
  fuelPanel.loading = true
  try {
    if (getPlayerStatus() === 'unknown') await ensurePlayerStatus()
    const status = getPlayerStatus()
    fuelPanel.needsRegistration = status !== 'returning'
    if (fuelPanel.needsRegistration) {
      fuelPanel.message = status === 'new' ? REGISTER_FIRST : describeResult({ status: 'error' })
      return
    }
    const ok = await refreshSceneDrop()
    if (!ok) fuelPanel.message = describeResult({ status: 'error' })
  } finally {
    fuelPanel.loading = false
  }
  resumePendingPurchase()
  // No purchase in memory (e.g. the scene reloaded mid-purchase) — ask the server if it's still holding one for us.
  if (!getPendingManaPurchase() && !fuelPanel.busy) {
    void resumeServerPendingPurchase()
  }
}

/**
 * If a MANA payment was sent but never confirmed credited, pick it back up automatically. `pending` overrides the
 * in-memory record (used when the record was recovered from the server instead).
 */
function resumePendingPurchase(
  pending?: { tier: string; txHash: string },
  message = 'Finishing your last purchase…'
): Promise<void> {
  if (fuelPanel.busy) return Promise.resolve()
  const target = pending ?? getPendingManaPurchase()
  if (!target) return Promise.resolve()
  fuelPanel.busy = true
  fuelPanel.message = message
  return redeemAndReport(target.tier, target.txHash, { resuming: true })
    .catch((e) => {
      console.log('[fuel] resuming MANA purchase failed:', e)
      fuelPanel.message = paymentErrorMessage(e, 'Purchase failed. Try again soon.')
    })
    .finally(() => {
      fuelPanel.busy = false
    })
}

/**
 * Asks the server for any purchase it's still holding pending for this wallet and resumes the first one.
 * `recovering` (not `busy`) guards the fetch itself, so a fresh buy can't sneak in while it's in flight, and so
 * the resume that follows isn't skipped by a `busy` guard this function already set.
 */
async function resumeServerPendingPurchase(): Promise<void> {
  const previousMessage = fuelPanel.message
  fuelPanel.recovering = true
  fuelPanel.message = 'Checking for an unfinished purchase…'
  try {
    const pending = await getPendingManaPurchases()
    const first = pending[0]
    if (first) {
      await resumePendingPurchase({ tier: first.tier, txHash: first.txHash })
    } else {
      fuelPanel.message = previousMessage
    }
  } finally {
    fuelPanel.recovering = false
  }
}

export function closeFuelPanel(): void {
  fuelPanel.open = false
}

async function run(action: () => Promise<DropResult>): Promise<void> {
  if (fuelPanel.busy) return
  fuelPanel.busy = true
  fuelPanel.message = ''
  const result = await action()
  fuelPanel.busy = false
  fuelPanel.message = describeResult(result)
  if (result.status === 'ok') {
    fuelPanel.code = ''
    playDispenseEffect()
  }
}

export function claimSceneFuel(): void {
  void run(claimLiveSceneDrop)
}

export function submitCode(): void {
  void run(() => redeemCode(fuelPanel.code))
}

/** Polls the server to confirm a sent payment and reports the outcome; shared by a fresh buy and a resumed one. */
async function redeemAndReport(tierId: string, txHash: string, opts?: { resuming?: boolean }): Promise<void> {
  const cells = MANA_TIERS.find((t) => t.id === tierId)?.cells
  const prefix = opts?.resuming ? 'Finishing your last purchase: ' : ''
  const result = await redeemManaPurchase(tierId, txHash, (attempt) => {
    fuelPanel.message = `${prefix}Waiting for Polygon to confirm… (${(attempt * CONFIRM_POLL_MS) / 1000}s)`
  })
  if (result.alreadyRedeemed) {
    fuelPanel.message = 'Purchase already completed.'
    await refreshSceneDrop()
    return
  }
  if (typeof result.fuelCells === 'number') {
    fuelPanel.message = cells
      ? `Purchased ${cells} Fuel Cell${cells === 1 ? '' : 's'}! Your ship now holds ${result.fuelCells}.`
      : `Purchase complete! Your ship now holds ${result.fuelCells}.`
    playDispenseEffect()
  }
}

/** Store: pay for a tier in MANA on Polygon, then wait for the server to verify and credit it */
export async function buyTier(tier: ManaTier): Promise<void> {
  if (fuelPanel.busy || fuelPanel.recovering) return
  if (getPendingManaPurchase()) {
    // Don't let a new tier click stomp on a payment already sent but not yet confirmed credited.
    await resumePendingPurchase(undefined, 'Finishing your last purchase first…')
    return
  }
  fuelPanel.busy = true
  fuelPanel.message = `Confirm sending ${tier.mana} MANA (Polygon) in your wallet…`
  try {
    const txHash = await payMana(tier.mana, () => {
      fuelPanel.message = 'Confirm in your wallet… (waiting for your wallet)'
    })
    fuelPanel.message = 'Payment sent. Waiting for Polygon to confirm…'
    await redeemAndReport(tier.id, txHash)
  } catch (e) {
    console.log('[fuel] MANA purchase failed:', e)
    fuelPanel.message = paymentErrorMessage(e, 'Purchase failed. Try again soon.')
  } finally {
    fuelPanel.busy = false
  }
}

// ── Operator switch ──

/** Whether the local player's wallet is on the operator list. The server does the real check. */
export function isDispenserOperator(): boolean {
  const wallet = getPlayer()?.userId?.toLowerCase()
  return !!wallet && DISPENSER_OPERATORS.includes(wallet)
}

export async function toggleDispenser(): Promise<void> {
  if (fuelPanel.toggling) return
  fuelPanel.toggling = true
  const turnOn = !isDispenserEnabled()
  try {
    const result = await setDispenserEnabled(turnOn)
    if (result.ok) {
      setDispenserEnabledState(result.dispenserEnabled)
      // A purchase in progress owns the status line; don't stomp on it with the toggle's own copy.
      if (!fuelPanel.busy) {
        fuelPanel.message = result.dispenserEnabled ? 'Dispenser switched ON.' : 'Dispenser switched OFF.'
      }
    } else if (!fuelPanel.busy) {
      fuelPanel.message = toggleFailureMessage(result.status)
    }
  } catch (e) {
    console.log('[fuel] dispenser switch failed:', e)
    if (!fuelPanel.busy) fuelPanel.message = toggleFailureMessage()
  } finally {
    fuelPanel.toggling = false
  }
}

function toggleFailureMessage(status?: string): string {
  if (status === '401' || status === 'unauthorized') return "Couldn't verify your wallet."
  if (status === '403' || status === 'forbidden') return "This wallet can't switch the dispenser."
  return "Couldn't reach the dispenser. Try again."
}
