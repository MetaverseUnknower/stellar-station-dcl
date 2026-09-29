// Galaxy Gardeners — MANA payments on Polygon, ported from the main scene. The player's wallet sends an ERC-20
// transfer to the game wallet, and the API only credits fuel cells after it has verified that transaction on chain.
import { createEthereumProvider } from '@dcl/sdk/ethereum-provider'
import { getPlayer } from '@dcl/sdk/players'
import { purchaseFuelCellsMana } from './api'

export const POLYGON_CHAIN_ID = '0x89'
export const POLYGON_MANA = '0xA1c57f48F0Deb89f569dFbE6E2B7f46D33606fD4'
export const MANA_BENEFICIARY = '0x7e567DEaBFFCeCEea48dA456EBb9Ef84d159374C' // MetaPetal, owner of metapetal.dcl.eth

export const CONFIRM_POLL_MS = 3000
const CONFIRM_MAX_POLLS = 60 // three minutes, plenty for Polygon
const TRANSFER_SELECTOR = '0xa9059cbb' // transfer(address,uint256)

export interface ManaTier {
  id: string
  name: string
  cells: number
  mana: number
  image: string
}

/** Same tiers and ids as the main scene's store; the server prices them by id */
export const MANA_TIERS: ManaTier[] = [
  { id: 'mana_single', name: 'Quick Top-Up', cells: 1, mana: 10, image: 'assets/images/QuickTopUp.png' },
  { id: 'mana_triple', name: 'Explorer Pack', cells: 3, mana: 20, image: 'assets/images/ExplorerPack.png' },
  { id: 'mana_bulk', name: 'Deep Space Expedition', cells: 10, mana: 50, image: 'assets/images/DeepSpaceExpedition.png' }
]

let provider: ReturnType<typeof createEthereumProvider> | null = null
let rpcId = 1

function rpc(method: string, params: unknown[]): Promise<any> {
  if (!provider) provider = createEthereumProvider()
  const p = provider
  return new Promise((resolve, reject) => {
    p.sendAsync({ id: rpcId++, jsonrpc: '2.0', method, params }, (err, result) => {
      if (err) {
        reject(err)
        return
      }
      if (result && typeof result === 'object' && 'error' in result && result.error) {
        reject(new Error(result.error.message ?? 'Wallet request failed'))
        return
      }
      resolve(result && typeof result === 'object' && 'result' in result ? result.result : result)
    })
  })
}

const pad32 = (hex: string) => hex.replace(/^0x/, '').toLowerCase().padStart(64, '0')

const WALLET_TIMEOUT_MS = 120_000 // a hanging PRE-FLIGHT call must not leave the panel busy forever
const WALLET_TIMEOUT_MESSAGE = 'No response from your wallet. Check it and try again.'

/** Races a wallet RPC call against a timeout so a hung wallet clears `busy` instead of stalling forever. */
function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (err) => {
        clearTimeout(timer)
        reject(err)
      }
    )
  })
}

const SEND_ANSWER_MS = 90_000 // how long the panel waits on the wallet to send
const SEND_ABANDON_MS = 300_000 // after which a still-unanswered send is taken as gone for good
const NO_ANSWER_MESSAGE = 'Your wallet didn’t answer. If it does send the payment, it’ll still be credited.'
let sendOpenSince: number | null = null // when the wallet was asked to send a payment it hasn't answered yet

const walletRpc = (method: string, params: unknown[]) => withTimeout(rpc(method, params), WALLET_TIMEOUT_MS, WALLET_TIMEOUT_MESSAGE)

/**
 * Asks the wallet to send `mana` MANA on Polygon to the game wallet. Resolves with the transaction hash.
 * `onSending` fires right before the wallet is asked to send, once the wallet has been asked to switch to Polygon.
 * `onLate` gets the hash of a payment the wallet sent after payMana had given up waiting (see below).
 */
export async function payMana(mana: number, onSending?: () => void, onLate?: (txHash: string) => void): Promise<string> {
  const from = getPlayer()?.userId
  if (!from || !/^0x[0-9a-fA-F]{40}$/.test(from)) throw new Error('Connect a wallet to buy with MANA')
  if (sendOpenSince !== null && Date.now() - sendOpenSince < SEND_ABANDON_MS) {
    throw new Error('Your wallet still has your last payment open. Finish with it there, then try again.')
  }

  try {
    await walletRpc('wallet_switchEthereumChain', [{ chainId: POLYGON_CHAIN_ID }])
  } catch {
    // the wallet may already be on Polygon or refuse; the server rejects wrong-chain payments
  }
  // No eth_chainId check: Decentraland's wallet sends Polygon transactions while reporting Ethereum as its chain,
  // so a check here turned away players whose payment would have gone through (as it does in the ship scene).

  const wei = BigInt(Math.round(mana * 1000)) * 10n ** 15n
  const data = TRANSFER_SELECTOR + pad32(MANA_BENEFICIARY) + pad32(wei.toString(16))
  onSending?.()
  // Close the wallet's confirmation without rejecting it and the explorer can leave this request unanswered, for
  // minutes or for good, and it won't open another while it's waiting. So the panel stops waiting after
  // SEND_ANSWER_MS, but the request is kept: if the wallet does send the payment late, `onLate` gets its hash so it
  // can still be credited, and until the request's answered (or SEND_ABANDON_MS has gone by) a new payment isn't
  // asked for, since the wallet wouldn't show it.
  const started = Date.now()
  sendOpenSince = started
  const send = rpc('eth_sendTransaction', [{ from, to: POLYGON_MANA, data, value: '0x0' }])
  const answered = () => {
    if (sendOpenSince === started) sendOpenSince = null
  }
  send.then(answered, answered)
  let hash: unknown
  try {
    hash = await withTimeout(send, SEND_ANSWER_MS, NO_ANSWER_MESSAGE)
  } catch (e) {
    if (e instanceof Error && e.message === NO_ANSWER_MESSAGE) {
      send.then(
        (late) => {
          if (isTxHash(late)) {
            console.log('[pay] the wallet sent the payment late:', late)
            onLate?.(late)
          }
        },
        () => {}
      )
    }
    throw e
  }
  if (!isTxHash(hash)) throw new Error('Wallet did not return a transaction hash')
  return hash
}

const isTxHash = (h: unknown): h is string => typeof h === 'string' && /^0x[0-9a-fA-F]{64}$/.test(h)

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** Trims a tx hash for display, e.g. "0xabcd…1234". Log the full hash separately. */
export function shortHash(hash: string): string {
  return `${hash.slice(0, 6)}…${hash.slice(-4)}`
}

/** The status code out of an api.ts `Error("API error <status>: <body>")`, or null if it isn't one (e.g. a network error). */
function apiErrorStatus(err: unknown): number | null {
  const msg = err instanceof Error ? err.message : String(err ?? '')
  const m = /^API error (\d+):/.exec(msg)
  return m ? Number(m[1]) : null
}

export interface ManaPurchaseResult {
  /** Set once the server has credited the tier. */
  fuelCells?: number
  /** The hash had already been redeemed (a resumed purchase, most likely) — treat it as done, not an error. */
  alreadyRedeemed?: boolean
}

/**
 * The last MANA payment sent but not yet confirmed credited. Kept in module state so the panel can resume
 * redeeming it the next time it opens — resubmitting is safe, since the server returns 409 for a hash it
 * already redeemed.
 */
let pendingPurchase: { tier: string; txHash: string } | null = null

export function getPendingManaPurchase(): { tier: string; txHash: string } | null {
  return pendingPurchase
}

/** A payment the wallet sent after the panel stopped waiting: remembered, so the panel finishes it before any other. */
export function rememberManaPurchase(tier: string, txHash: string): void {
  pendingPurchase = { tier, txHash }
}

/** Redeems a payment with the API, retrying while Polygon has not confirmed the transaction yet. */
export async function redeemManaPurchase(
  tier: string,
  txHash: string,
  onPending?: (attempt: number) => void
): Promise<ManaPurchaseResult> {
  pendingPurchase = { tier, txHash }
  for (let attempt = 1; attempt <= CONFIRM_MAX_POLLS; attempt++) {
    try {
      const result = await purchaseFuelCellsMana(tier, txHash)
      if (result.status === 'ok' && typeof result.fuelCells === 'number') {
        pendingPurchase = null
        return { fuelCells: result.fuelCells }
      }
      // status === 'pending' (202): Polygon hasn't confirmed the transfer yet, keep polling
    } catch (e) {
      const status = apiErrorStatus(e)
      if (status === 400 || status === 402) {
        pendingPurchase = null
        throw e
      }
      if (status === 409) {
        // The hash was already redeemed (most likely by an earlier attempt) — the purchase is done.
        pendingPurchase = null
        return { alreadyRedeemed: true }
      }
      // Network errors, 5xx responses and a failed re-auth: the MANA is already sent, so keep polling
      // within the same bounded budget instead of aborting.
      console.log('[fuel] MANA purchase check failed, treating as still pending:', e)
    }
    onPending?.(attempt)
    await delay(CONFIRM_POLL_MS)
  }
  console.log('[fuel] MANA purchase still unconfirmed after max polls. Full hash:', txHash)
  throw new Error('Still confirming on Polygon. Reopen the dispenser to finish.')
}

/** Turns an API error ("API error 402: {"error":"..."}") into the server's message. */
export function paymentErrorMessage(err: unknown, fallback: string): string {
  const msg = err instanceof Error ? err.message : String(err ?? '')
  const m = /^API error \d+: (.*)$/s.exec(msg)
  if (m) {
    try {
      return JSON.parse(m[1]).error ?? fallback
    } catch {
      return fallback
    }
  }
  if (/reject|denied|cancel/i.test(msg)) return 'Payment cancelled'
  return msg || fallback
}
