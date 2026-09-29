// The black market's relay to the Eld: its state and actions (panelUi.tsx draws it every frame from `market`).
// The server does the work (routes/blackMarket.ts): a quote says whether a purchase can go ahead before any MANA
// moves; then the wallet pays (fuel/payments.ts payMana, the same transfer the fuel store uses) and the server,
// once Polygon confirms it, checks again and applies it. A payment still unconfirmed when the scene reloads is
// picked up again from the server's pending list the next time the terminal opens.
import * as api from '../api'
import {
  getMarketCatalog, quoteMarket, getMarketPending, getMarketMine, getFriends, buyFromMarket,
  type MarketItem, type MarketParams, type Friend
} from '../stationApi'
import { payMana, paymentErrorMessage, CONFIRM_POLL_MS } from '../fuel/payments'
import type { StarSystem } from '../types'

const CONFIRM_MAX_POLLS = 60 // three minutes
const STAR_RESULTS = 6
export const MAX_GUESTS = 20 // server rules.ts MAX_GUESTS

export type Phase = 'browse' | 'quoted' | 'paying' | 'confirming' | 'done'

export const market = {
  open: false,
  loading: false,
  items: [] as MarketItem[],
  selected: null as MarketItem | null,
  phase: 'browse' as Phase,
  busy: false,
  message: '',
  /** true when the message is bad news */
  warn: false,
  summary: '',
  // params
  starQuery: '',
  star: null as StarSystem | null,
  name: '',
  radio: '',
  guests: [] as string[],
  // lookups
  stars: [] as StarSystem[],
  friends: [] as Friend[],
  mine: '' // "Cloaked until 14:20 · 1 insurance policy"
}

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
const hhmm = (iso: string) => new Date(iso).toISOString().slice(11, 16)

function say(message: string, warn = false): void {
  market.message = message
  market.warn = warn
}

export async function openMarket(): Promise<void> {
  market.open = true
  if (market.busy) return // a purchase in flight owns the panel; just show it
  if (market.phase === 'done') resetPurchase()
  if (market.items.length) {
    void getFriends().then((f) => { market.friends = f.friends ?? [] }).catch(() => {}) // friends made since
    void refreshMine()
    void resumePending()
    return
  }
  market.loading = true
  say('')
  try {
    const [catalog, me] = await Promise.all([getMarketCatalog(), api.getPlayerMe()])
    market.items = catalog.items
    const [systems, friends] = await Promise.all([
      api.getSystems(me.galaxy_id),
      getFriends().catch(() => ({ friends: [] as Friend[] }))
    ])
    market.stars = systems.filter((s) => !(s as { remnant_at?: string | null }).remnant_at).sort((a, b) => a.name.localeCompare(b.name))
    market.friends = friends.friends ?? []
    market.selected = null
  } catch (e) {
    console.log('[black market] open failed', e)
    say('The relay is silent. Try again in a minute.', true)
  } finally {
    market.loading = false
  }
  void refreshMine()
  void resumePending()
}

export function closeMarket(): void {
  market.open = false
}

async function refreshMine(): Promise<void> {
  try {
    const mine = await getMarketMine()
    const bits: string[] = []
    if (mine.cloakedUntil) bits.push(`Cloaked until ${hhmm(mine.cloakedUntil)} UTC`)
    if (mine.insurancePolicies) bits.push(`${mine.insurancePolicies} insurance polic${mine.insurancePolicies === 1 ? 'y' : 'ies'}`)
    market.mine = bits.join('  ·  ')
  } catch {
    market.mine = ''
  }
}

function resetPurchase(): void {
  market.phase = 'browse'
  market.summary = ''
  say('')
}

export function selectItem(item: MarketItem): void {
  if (market.busy) return
  market.selected = item
  if (item.kind !== 'wormhole' || !item.exclusive) market.guests = []
  resetPurchase()
}

/** Any change to what's being bought invalidates the quote. */
export function paramsChanged(): void {
  if (market.phase === 'quoted') resetPurchase()
}

export function starMatches(): StarSystem[] {
  const q = market.starQuery.trim().toLowerCase()
  if (!q) return []
  return market.stars.filter((s) => s.name.toLowerCase().includes(q)).slice(0, STAR_RESULTS)
}

export function pickStar(star: StarSystem): void {
  market.star = star
  market.starQuery = ''
  paramsChanged()
}

export function toggleGuest(playerId: string): void {
  const i = market.guests.indexOf(playerId)
  if (i >= 0) market.guests.splice(i, 1)
  else if (market.guests.length < MAX_GUESTS) market.guests.push(playerId)
  paramsChanged()
}

export const needsStar = (item: MarketItem | null) => !!item && (item.kind === 'wormhole' || item.kind === 'destroy' || item.kind === 'rename')

function params(item: MarketItem): MarketParams {
  switch (item.kind) {
    case 'wormhole':
      return { targetSystemId: market.star?.id, guests: item.exclusive ? [...market.guests] : [] }
    case 'destroy':
      return { systemId: market.star?.id }
    case 'rename':
      return { systemId: market.star?.id, name: market.name }
    case 'radio':
      return { message: market.radio }
    default:
      return {}
  }
}

/** Ask the Eld whether it can be done (nothing is paid). */
export async function askQuote(): Promise<void> {
  const item = market.selected
  if (!item || market.busy) return
  if (needsStar(item) && !market.star) {
    say('Name a star first.', true)
    return
  }
  market.busy = true
  say('Transmitting your petition…')
  try {
    const q = await quoteMarket(item.id, params(item))
    market.summary = q.summary
    market.phase = 'quoted'
    say('')
  } catch (e) {
    say(e instanceof Error ? e.message : 'No answer came.', true)
  } finally {
    market.busy = false
  }
}

/** Pay for the quoted purchase, then wait for the server to settle it. */
export async function pay(): Promise<void> {
  const item = market.selected
  if (!item || market.busy || market.phase !== 'quoted') return
  market.busy = true
  market.phase = 'paying'
  say(`Confirm the offering of ${item.mana} MANA (Polygon) in your wallet…`)
  const sent = params(item)
  let txHash: string
  try {
    txHash = await payMana(
      item.mana,
      () => say('Confirm in your wallet…'),
      (late) => void settleLate(item.id, sent, late)
    )
  } catch (e) {
    market.phase = 'quoted'
    market.busy = false
    say(paymentErrorMessage(e, 'Payment failed.'), true)
    return
  }
  await settle(item.id, sent, txHash)
}

/** The wallet sent the offering after the terminal stopped waiting for it: settle it once the terminal's free. */
async function settleLate(itemId: string, sent: MarketParams, txHash: string): Promise<void> {
  while (market.busy) await delay(CONFIRM_POLL_MS)
  market.selected = market.items.find((i) => i.id === itemId) ?? market.selected
  await settle(itemId, sent, txHash, true)
}

/** Poll the server until the payment is settled one way or the other. */
async function settle(itemId: string, sent: MarketParams, txHash: string, resuming = false): Promise<void> {
  market.busy = true
  market.phase = 'confirming'
  const prefix = resuming ? 'Your last petition: ' : ''
  try {
    for (let attempt = 1; attempt <= CONFIRM_MAX_POLLS; attempt++) {
      const r = await buyFromMarket(itemId, sent, txHash)
      if (r.status === 'ok') {
        market.phase = 'done'
        market.summary = r.summary
        say('It is done.')
        void refreshMine()
        return
      }
      if (r.status === 'error' && r.final) {
        market.phase = 'done'
        say(r.message, true)
        return
      }
      say(`${prefix}The offering crosses Polygon… (${(attempt * CONFIRM_POLL_MS) / 1000}s)`)
      await delay(CONFIRM_POLL_MS)
    }
    market.phase = 'done'
    say('Still crossing Polygon. Return to the relay to finish.', true)
  } finally {
    market.busy = false
  }
}

/** A payment the server saw but hasn't settled (the scene reloaded mid-deal): finish it. */
async function resumePending(): Promise<void> {
  if (market.busy) return
  try {
    const { pending } = await getMarketPending()
    const first = pending[0]
    if (!first || market.busy) return
    market.selected = market.items.find((i) => i.id === first.item) ?? market.selected
    await settle(first.item, first.params ?? {}, first.txHash, true)
  } catch (e) {
    console.log('[black market] pending check failed', e)
  }
}

/** "Another petition" after one is done. */
export function again(): void {
  if (market.busy) return
  resetPurchase()
}
