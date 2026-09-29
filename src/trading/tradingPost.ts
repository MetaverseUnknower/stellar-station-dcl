// Trading Post (hub floor): this station's specimen and resource market, on the ship's desk framework (stations.ts).
// Tabs: BOARD (offers here; accept or cancel), POST OFFER, MY TRADES (your offers and history), GALLERY (species
// traded here). The server does the trading (routes/trades.ts; accept_trade etc. in 050_atomic_trades.sql): posting
// and accepting need docking at this station, and a trade can't overfill either side's cargo hold or vault.
import { engine, TextAlignMode } from '@dcl/sdk/ecs'
import { Color4, Vector3 } from '@dcl/sdk/math'
import * as api from '../api'
import * as trades from '../stationApi'
import { TradeOffer, TradeItem, TradeRecord, GalleryEntry, OfferedItemInput, RequestedItemInput } from '../stationApi'
import { createStation, ViewDefinition, StationContext, Screens, refreshStation } from '../stations'
import { Bag, clearBag, clickable, text, frame, header, button, listRow, image, fitSize, CYAN, MAGENTA, MAGENTA3, WHITE, DIM, MUTED, GREEN, RED } from '../stations/draw'
import { cargoUsed, titleCase } from '../stations/data'
import { showNotification } from '../shipDialogs'
import { onGateChanged } from '../gate'
import { hubDesk, HUB_DESK_ANGLES, playerNear } from '../station'
import {
  Specimen, RARITY_ORDER, RESOURCE_TYPES, resourceName, requestText, offerText, listText, summaryText,
  matchesRequest, daysLeft, shortDate
} from './tradeText'

const POLL_SECONDS = 15
const LEFT = TextAlignMode.TAM_MIDDLE_LEFT
const RIGHT = TextAlignMode.TAM_MIDDLE_RIGHT
const ERR = Color4.create(1, 0.35, 0.35, 1)
const MAX_ITEMS = 8 // per side, as the server allows

// ---- shared state ----
let stationId: string | null = null
let board: TradeOffer[] = []
let catalog = new Map<string, { name: string; rarity: string }>()
let redrawActive: (() => void) | null = null

async function loadBoard(): Promise<void> {
  if (stationId) board = await trades.getStationTrades(stationId)
}

async function loadCatalog(): Promise<void> {
  const entries = await api.getCatalog()
  catalog = new Map(entries.map((e: any) => [e.id, { name: e.name ?? 'Unknown', rarity: e.rarity ?? 'common' }]))
}

function specimens(ctx: StationContext): Specimen[] {
  return (ctx.dashboard?.specimenSamples ?? []).map((s: any) => ({
    id: s.id,
    speciesId: s.species_id,
    name: catalog.get(s.species_id)?.name ?? 'Unknown species',
    rarity: catalog.get(s.species_id)?.rarity ?? 'common',
    body: s.body_name ?? '',
    locked: !!s.locked_in_trade
  }))
}

function inventory(ctx: StationContext): Record<string, number> {
  const inv: Record<string, number> = {}
  for (const r of ctx.dashboard?.inventory ?? []) inv[r.resource_type] = r.quantity ?? 0
  return inv
}

/** After a trade: this desk's data and the Ship Services desks, which show the same cargo and vault. */
async function afterTrade(ctx: StationContext): Promise<void> {
  await Promise.all([loadBoard().catch(() => {}), ctx.refresh(), refreshStation('flora'), refreshStation('ship')])
}

function tabs(into: Bag, top: Screens['top'], ctx: StationContext, active: string): void {
  header(into, top, -2.6, 1.05, { title: 'TRADING POST', subtitle: 'specimen & resource exchange' })
  const list: [string, string][] = [['board', 'BOARD'], ['post', 'POST OFFER'], ['mine', 'MY TRADES'], ['gallery', 'GALLERY']]
  list.forEach(([id, label], i) => {
    button(into, top, -0.05 + i * 0.72, 1.05, 0.68, 0.24, label, label, () => ctx.setView(id), {
      size: 0.16,
      variant: id === active ? 'primary' : 'outline'
    })
  })
}

function fail(ctx: StationContext, err: any, fallback: string): void {
  ctx.notify(err?.message || fallback, Color4.create(1, 0.3, 0.3, 1))
}

// =====================================================================================================
// BOARD
// =====================================================================================================
const BOARD_ROWS = 5

function makeBoardView(): ViewDefinition {
  const topBag: Bag = []
  const lowBag: Bag = []
  let screens: Screens | null = null
  let ctxRef: StationContext | null = null
  let page = 0
  let selectedId: string | null = null
  const choice: Record<string, number> = {} // requested sample item id -> index into its matching specimens
  let working = false

  function drawTop(): void {
    if (!screens || !ctxRef) return
    clearBag(topBag)
    const top = screens.top
    tabs(topBag, top, ctxRef, 'board')
    const pages = Math.max(1, Math.ceil(board.length / BOARD_ROWS))
    page = Math.min(page, pages - 1)
    if (board.length === 0) {
      text(topBag, top, 0, -0.1, 'No open offers at this station.\nPost the first one!', 0.32, MUTED)
    }
    board.slice(page * BOARD_ROWS, page * BOARD_ROWS + BOARD_ROWS).forEach((t, i) => {
      const y = 0.6 - i * 0.36
      const sel = t.id === selectedId
      const row = frame(topBag, top, 0, y, 5.3, 0.32, { border: sel ? MAGENTA3 : undefined, fill: Color4.create(sel ? 0.15 : 0.02, 0.03, sel ? 0.12 : 0.1, 0.8) })
      text(topBag, top, -2.55, y + 0.07, t.isMe ? `${t.posterUsername} (you)` : t.posterUsername, 0.2, t.isMe ? MAGENTA : CYAN, LEFT)
      const gives = `GIVES ${listText(t.offered, offerText)}`
      const wants = `WANTS ${listText(t.requested, requestText)}`
      text(topBag, top, -1.2, y + 0.07, gives, fitSize(gives, 3.3, 0.17), WHITE, LEFT)
      text(topBag, top, -1.2, y - 0.08, wants, fitSize(wants, 3.3, 0.17), DIM, LEFT)
      text(topBag, top, 2.55, y - 0.08, daysLeft(t.expiresAt), 0.15, MUTED, RIGHT)
      clickable(row, `Offer from ${t.posterUsername}`, () => { selectedId = t.id; drawTop(); drawLow() })
    })
    text(topBag, top, -2.55, -1.22, `${board.length} OPEN OFFER${board.length === 1 ? '' : 'S'}  //  REFRESHES EVERY ${POLL_SECONDS}S`, 0.15, MUTED, LEFT)
    if (page > 0) button(topBag, top, 1.2, -1.22, 0.62, 0.2, '‹ PREV', 'Previous page', () => { page--; drawTop() }, { size: 0.15 })
    if (page < pages - 1) button(topBag, top, 1.95, -1.22, 0.62, 0.2, 'NEXT ›', 'Next page', () => { page++; drawTop() }, { size: 0.15 })
  }

  function drawLow(): void {
    if (!screens || !ctxRef) return
    clearBag(lowBag)
    const low = screens.low
    const ctx = ctxRef
    const t = board.find(x => x.id === selectedId)
    if (!t) {
      text(lowBag, low, 0, 0, board.length ? 'Select an offer above' : 'Nothing to trade yet', 0.36, MUTED)
      return
    }
    const inv = inventory(ctx)
    const mine = specimens(ctx)

    // Left: what you get
    frame(lowBag, low, -1.85, 0.05, 1.75, 2.0)
    text(lowBag, low, -2.6, 0.9, t.isMe ? 'YOU OFFERED' : 'YOU RECEIVE', 0.24, DIM, LEFT)
    t.offered.forEach((item, i) => {
      const s = offerText(item)
      text(lowBag, low, -2.6, 0.6 - i * 0.22, s, fitSize(s, 1.5, 0.22), GREEN, LEFT)
    })

    // Middle: what you give, with the specimen chosen for each requested one
    frame(lowBag, low, 0, 0.05, 1.75, 2.0)
    text(lowBag, low, -0.75, 0.9, t.isMe ? 'YOU ASKED FOR' : 'YOU GIVE', 0.24, DIM, LEFT)
    const used = new Set<string>()
    const fulfilled: { itemId: string; sampleId: string }[] = []
    let problem: string | null = null
    let y = 0.6
    for (const item of t.requested) {
      const s = requestText(item)
      if (item.itemType === 'resource') {
        const have = inv[item.resourceType ?? ''] ?? 0
        const ok = have >= (item.quantity ?? 0)
        text(lowBag, low, -0.75, y, s, fitSize(s, 1.1, 0.22), ok || t.isMe ? WHITE : RED, LEFT)
        if (!t.isMe) text(lowBag, low, 0.75, y, `${have}`, 0.2, ok ? GREEN : RED, RIGHT)
        if (!ok && !problem) problem = `Need ${item.quantity} ${resourceName(item.resourceType)}`
        y -= 0.24
        continue
      }
      text(lowBag, low, -0.75, y, s, fitSize(s, 1.5, 0.22), WHITE, LEFT)
      y -= 0.2
      if (t.isMe) continue
      const options = mine.filter(m => matchesRequest(m, item) && !used.has(m.id))
      if (options.length === 0) {
        text(lowBag, low, -0.65, y, 'no matching specimen in your vault', 0.16, RED, LEFT)
        if (!problem) problem = 'No matching specimen'
      } else {
        const idx = ((choice[item.id] ?? 0) % options.length + options.length) % options.length
        const pick = options[idx]
        used.add(pick.id)
        fulfilled.push({ itemId: item.id, sampleId: pick.id })
        const label = `using ${pick.name}${pick.body ? ` · ${pick.body}` : ''}`
        text(lowBag, low, -0.65, y, label, fitSize(label, 1.05, 0.16), CYAN, LEFT)
        if (options.length > 1) {
          button(lowBag, low, 0.52, y, 0.18, 0.16, '‹', 'Previous specimen', () => { choice[item.id] = idx - 1; drawLow() }, { size: 0.14 })
          button(lowBag, low, 0.74, y, 0.18, 0.16, '›', 'Next specimen', () => { choice[item.id] = idx + 1; drawLow() }, { size: 0.14 })
        }
      }
      y -= 0.24
    }

    // Right: cargo and vault after the trade, and the action
    frame(lowBag, low, 1.85, 0.05, 1.75, 2.0)
    const ship = ctx.dashboard?.ship
    if (!t.isMe && ship) {
      const resIn = t.offered.filter(i => i.itemType === 'resource').reduce((n, i) => n + (i.quantity ?? 0), 0)
      const resOut = t.requested.filter(i => i.itemType === 'resource').reduce((n, i) => n + (i.quantity ?? 0), 0)
      const smpIn = t.offered.filter(i => i.itemType === 'sample').length
      const smpOut = t.requested.filter(i => i.itemType === 'sample').length
      const cargo = cargoUsed(ctx.dashboard)
      const vault = (ctx.dashboard?.specimenSamples ?? []).length
      const cargoAfter = cargo + resIn - resOut
      const vaultAfter = vault + smpIn - smpOut
      const cargoOk = cargoAfter <= ship.resource_storage || cargoAfter <= cargo
      const vaultOk = vaultAfter <= ship.specimen_vault || vaultAfter <= vault
      text(lowBag, low, 1.1, 0.9, 'AFTER THIS TRADE', 0.24, DIM, LEFT)
      text(lowBag, low, 1.1, 0.6, 'CARGO', 0.2, DIM, LEFT)
      text(lowBag, low, 2.6, 0.6, `${cargo} → ${cargoAfter} / ${ship.resource_storage}`, 0.2, cargoOk ? WHITE : RED, RIGHT)
      text(lowBag, low, 1.1, 0.38, 'VAULT', 0.2, DIM, LEFT)
      text(lowBag, low, 2.6, 0.38, `${vault} → ${vaultAfter} / ${ship.specimen_vault}`, 0.2, vaultOk ? WHITE : RED, RIGHT)
      if (!cargoOk && !problem) problem = 'Not enough cargo space'
      if (!vaultOk && !problem) problem = 'Specimen vault is full'
    }
    text(lowBag, low, 1.85, 0.05, `from ${t.posterUsername}  ·  ${daysLeft(t.expiresAt)}`, 0.17, MUTED)
    if (working) {
      button(lowBag, low, 1.85, -0.5, 1.55, 0.42, 'WORKING…', 'Working', () => {}, { variant: 'disabled', size: 0.34 })
    } else if (t.isMe) {
      button(lowBag, low, 1.85, -0.5, 1.55, 0.42, 'CANCEL OFFER', 'Cancel this offer', () => void cancel(t), { variant: 'magenta', size: 0.3 })
      text(lowBag, low, 1.85, -0.85, 'returns your items to your ship', 0.15, MUTED)
    } else if (problem) {
      button(lowBag, low, 1.85, -0.5, 1.55, 0.42, 'CAN’T ACCEPT', problem, () => {}, { variant: 'disabled', size: 0.3 })
      text(lowBag, low, 1.85, -0.85, problem, fitSize(problem, 1.6, 0.17), ERR)
    } else {
      button(lowBag, low, 1.85, -0.5, 1.55, 0.42, 'ACCEPT TRADE', 'Accept this trade', () => void accept(t, fulfilled), { variant: 'primary', size: 0.32 })
    }
  }

  async function accept(t: TradeOffer, fulfilled: { itemId: string; sampleId: string }[]): Promise<void> {
    const ctx = ctxRef
    if (!ctx || working) return
    working = true
    drawLow()
    try {
      await ctx.busy(trades.acceptTrade(t.id, fulfilled))
      ctx.notify(`Trade complete with ${t.posterUsername}!`, Color4.create(0, 1, 0.5, 1))
      selectedId = null
    } catch (err) {
      fail(ctx, err, 'Trade failed')
    }
    working = false
    await afterTrade(ctx)
  }

  async function cancel(t: TradeOffer): Promise<void> {
    const ctx = ctxRef
    if (!ctx || working) return
    working = true
    drawLow()
    try {
      await ctx.busy(trades.cancelTrade(t.id))
      ctx.notify('Offer cancelled. Your items are back aboard.', Color4.create(0, 0.9, 1, 1))
      selectedId = null
    } catch (err) {
      fail(ctx, err, 'Could not cancel')
    }
    working = false
    await afterTrade(ctx)
  }

  return {
    id: 'board',
    async render(s: Screens, ctx: StationContext): Promise<void> {
      screens = s
      ctxRef = ctx
      await Promise.all([loadBoard(), loadCatalog()])
      if (selectedId && !board.find(t => t.id === selectedId)) selectedId = null
      redrawActive = () => { drawTop(); drawLow() }
      drawTop()
      drawLow()
    },
    clear(): void {
      clearBag(topBag)
      clearBag(lowBag)
      screens = null
    }
  }
}

// =====================================================================================================
// POST OFFER
// =====================================================================================================
type SampleAsk =
  | { mode: 'open' }
  | { mode: 'rarity_tier'; rarity: string }
  | { mode: 'specific_species'; speciesId: string; name: string }

function makePostView(): ViewDefinition {
  const topBag: Bag = []
  const lowBag: Bag = []
  let screens: Screens | null = null
  let ctxRef: StationContext | null = null
  let offerRes: Record<string, number> = {}
  let offerSamples: string[] = []
  let askRes: Record<string, number> = {}
  let askSamples: SampleAsk[] = []
  let specimenPage = 0
  let posting = false
  let knownSpecies: { id: string; name: string }[] = []

  const offeredCount = () => Object.values(offerRes).filter(n => n > 0).length + offerSamples.length
  const askedCount = () => Object.values(askRes).filter(n => n > 0).length + askSamples.length

  function stepper(into: Bag, root: Screens['top'], x: number, y: number, value: number, set: (v: number) => void, max: number, hover: string): void {
    button(into, root, x, y, 0.2, 0.17, '−', `Less ${hover}`, () => set(Math.max(0, value - 1)), { size: 0.16, variant: value > 0 ? 'outline' : 'disabled' })
    text(into, root, x + 0.26, y, `${value}`, 0.19, value > 0 ? CYAN : MUTED)
    button(into, root, x + 0.52, y, 0.2, 0.17, '+', `More ${hover}`, () => set(Math.min(max, value + 1)), { size: 0.16, variant: value < max ? 'outline' : 'disabled' })
  }

  function drawTop(): void {
    if (!screens || !ctxRef) return
    clearBag(topBag)
    const top = screens.top
    const ctx = ctxRef
    tabs(topBag, top, ctx, 'post')
    const inv = inventory(ctx)

    // Left: resources to offer
    frame(topBag, top, -1.4, -0.2, 2.6, 2.1)
    text(topBag, top, -2.6, 0.7, 'YOU OFFER  ·  RESOURCES', 0.2, DIM, LEFT)
    const have = RESOURCE_TYPES.filter(r => (inv[r] ?? 0) > 0)
    if (have.length === 0) text(topBag, top, -1.4, -0.2, 'Your cargo hold is empty', 0.24, MUTED)
    have.forEach((r, i) => {
      const y = 0.45 - i * 0.2
      text(topBag, top, -2.6, y, resourceName(r), fitSize(resourceName(r), 1.15, 0.18), WHITE, LEFT)
      text(topBag, top, -1.0, y, `${inv[r]}`, 0.16, MUTED, RIGHT)
      stepper(topBag, top, -0.85, y, offerRes[r] ?? 0, v => { offerRes[r] = v; drawTop(); drawLow() }, inv[r], resourceName(r))
    })

    // Right: specimens to offer
    frame(topBag, top, 1.4, -0.2, 2.6, 2.1)
    text(topBag, top, 0.2, 0.7, 'YOU OFFER  ·  SPECIMENS', 0.2, DIM, LEFT)
    const free = specimens(ctx).filter(s => !s.locked)
    const per = 5
    const pages = Math.max(1, Math.ceil(free.length / per))
    specimenPage = Math.min(specimenPage, pages - 1)
    if (free.length === 0) text(topBag, top, 1.4, -0.2, 'No free specimens in your vault', 0.22, MUTED)
    free.slice(specimenPage * per, specimenPage * per + per).forEach((s, i) => {
      const on = offerSamples.includes(s.id)
      listRow(topBag, top, 1.4, 0.42 - i * 0.3, 2.4, 0.26, {
        label: `${on ? '✓ ' : ''}${s.name}  (${titleCase(s.rarity)})`,
        sublabel: s.body,
        selected: on,
        hover: on ? `Remove ${s.name}` : `Offer ${s.name}`,
        onClick: () => {
          offerSamples = on ? offerSamples.filter(id => id !== s.id) : [...offerSamples, s.id]
          drawTop()
          drawLow()
        }
      })
    })
    if (specimenPage > 0) button(topBag, top, 0.75, -1.1, 0.6, 0.2, '‹ PREV', 'Previous page', () => { specimenPage--; drawTop() }, { size: 0.15 })
    if (specimenPage < pages - 1) button(topBag, top, 2.05, -1.1, 0.6, 0.2, 'NEXT ›', 'Next page', () => { specimenPage++; drawTop() }, { size: 0.15 })
  }

  function drawLow(): void {
    if (!screens || !ctxRef) return
    clearBag(lowBag)
    const low = screens.low
    const ctx = ctxRef

    // Left: resources asked for
    frame(lowBag, low, -1.85, 0.05, 1.75, 2.1)
    text(lowBag, low, -2.65, 0.95, 'YOU ASK FOR  ·  RESOURCES', 0.18, DIM, LEFT)
    RESOURCE_TYPES.forEach((r, i) => {
      const y = 0.72 - i * 0.19
      text(lowBag, low, -2.65, y, resourceName(r), fitSize(resourceName(r), 0.9, 0.16), WHITE, LEFT)
      stepper(lowBag, low, -1.6, y, askRes[r] ?? 0, v => { askRes[r] = v; drawLow() }, 999, resourceName(r))
    })

    // Middle: specimens asked for
    frame(lowBag, low, 0, 0.05, 1.75, 2.1)
    text(lowBag, low, -0.8, 0.95, 'YOU ASK FOR  ·  SPECIMENS', 0.18, DIM, LEFT)
    askSamples.forEach((a, i) => {
      const y = 0.68 - i * 0.26
      const label = a.mode === 'open' ? 'Any specimen' : a.mode === 'rarity_tier' ? `Any ${titleCase(a.rarity)}+ specimen` : a.name
      const f = frame(lowBag, low, -0.1, y, 1.35, 0.22, { fill: Color4.create(0.02, 0.05, 0.12, 0.8) })
      text(lowBag, low, -0.72, y, label, fitSize(label, 1.1, 0.17), CYAN, LEFT)
      // Rarity and species requests cycle their choice when clicked.
      if (a.mode !== 'open') {
        clickable(f, a.mode === 'rarity_tier' ? 'Change rarity' : 'Change species', () => { cycle(i); drawLow() })
      }
      button(lowBag, low, 0.72, y, 0.22, 0.22, '×', 'Remove', () => { askSamples.splice(i, 1); drawLow() }, { size: 0.18, variant: 'magenta' })
    })
    if (askSamples.length < 4) {
      button(lowBag, low, -0.58, -0.62, 0.54, 0.2, '+ ANY', 'Ask for any specimen', () => { askSamples.push({ mode: 'open' }); drawLow() }, { size: 0.14 })
      button(lowBag, low, 0, -0.62, 0.54, 0.2, '+ RARITY', 'Ask for a minimum rarity (click it to change)', () => { askSamples.push({ mode: 'rarity_tier', rarity: 'rare' }); drawLow() }, { size: 0.14 })
      if (knownSpecies.length) {
        button(lowBag, low, 0.58, -0.62, 0.54, 0.2, '+ SPECIES', 'Ask for a species (click it to change)', () => {
          askSamples.push({ mode: 'specific_species', speciesId: knownSpecies[0].id, name: knownSpecies[0].name })
          drawLow()
        }, { size: 0.14 })
      }
      text(lowBag, low, 0, -0.85, 'click a rarity or species request to change it', 0.13, MUTED)
    }

    // Right: summary and post
    frame(lowBag, low, 1.85, 0.05, 1.75, 2.1)
    const offered = offeredCount()
    const asked = askedCount()
    text(lowBag, low, 1.1, 0.9, 'YOUR OFFER', 0.24, DIM, LEFT)
    text(lowBag, low, 1.1, 0.6, 'OFFERING', 0.2, DIM, LEFT)
    text(lowBag, low, 2.6, 0.6, `${offered} item${offered === 1 ? '' : 's'}`, 0.2, offered > MAX_ITEMS ? RED : WHITE, RIGHT)
    text(lowBag, low, 1.1, 0.38, 'ASKING FOR', 0.2, DIM, LEFT)
    text(lowBag, low, 2.6, 0.38, `${asked} item${asked === 1 ? '' : 's'}`, 0.2, asked > MAX_ITEMS ? RED : WHITE, RIGHT)
    text(lowBag, low, 1.85, 0.1, 'held in escrow until taken,\ncancelled, or expired (7 days)', 0.15, MUTED)
    const problem = offered === 0 ? 'Choose something to offer'
      : asked === 0 ? 'Choose something to ask for'
      : offered > MAX_ITEMS || asked > MAX_ITEMS ? `At most ${MAX_ITEMS} items each side`
      : null
    if (posting) button(lowBag, low, 1.85, -0.45, 1.55, 0.4, 'POSTING…', 'Posting', () => {}, { variant: 'disabled', size: 0.3 })
    else if (problem) button(lowBag, low, 1.85, -0.45, 1.55, 0.4, 'POST OFFER', problem, () => {}, { variant: 'disabled', size: 0.3 })
    else button(lowBag, low, 1.85, -0.45, 1.55, 0.4, 'POST OFFER', 'Post this offer', () => void post(), { variant: 'primary', size: 0.3 })
    text(lowBag, low, 1.85, -0.75, problem ?? '', 0.15, MUTED)
    button(lowBag, low, 1.85, -1.0, 0.8, 0.2, 'CLEAR', 'Clear the form', () => { reset(); drawTop(); drawLow() }, { size: 0.15 })
  }

  function cycle(i: number): void {
    const a = askSamples[i]
    if (a.mode === 'rarity_tier') {
      a.rarity = RARITY_ORDER[(RARITY_ORDER.indexOf(a.rarity) + 1) % RARITY_ORDER.length]
    } else if (a.mode === 'specific_species' && knownSpecies.length) {
      const next = knownSpecies[(knownSpecies.findIndex(s => s.id === a.speciesId) + 1) % knownSpecies.length]
      askSamples[i] = { mode: 'specific_species', speciesId: next.id, name: next.name }
    }
  }

  function reset(): void {
    offerRes = {}
    offerSamples = []
    askRes = {}
    askSamples = []
  }

  async function post(): Promise<void> {
    const ctx = ctxRef
    if (!ctx || posting || !stationId) return
    const offered: OfferedItemInput[] = [
      ...Object.entries(offerRes).filter(([, n]) => n > 0).map(([r, n]) => ({ type: 'resource' as const, resourceType: r, quantity: n })),
      ...offerSamples.map(id => ({ type: 'sample' as const, sampleId: id }))
    ]
    const requested: RequestedItemInput[] = [
      ...Object.entries(askRes).filter(([, n]) => n > 0).map(([r, n]) => ({ type: 'resource' as const, resourceType: r, quantity: n })),
      ...askSamples.map((a): RequestedItemInput =>
        a.mode === 'open' ? { type: 'sample', sampleRequestMode: 'open' }
        : a.mode === 'rarity_tier' ? { type: 'sample', sampleRequestMode: 'rarity_tier', requestedMinRarity: a.rarity }
        : { type: 'sample', sampleRequestMode: 'specific_species', requestedSpeciesId: a.speciesId })
    ]
    posting = true
    drawLow()
    try {
      await ctx.busy(trades.postTrade(stationId, offered, requested))
      ctx.notify('Offer posted on the station board.', Color4.create(0, 1, 0.5, 1))
      reset()
      posting = false
      await afterTrade(ctx)
      await ctx.setView('mine')
      return
    } catch (err) {
      fail(ctx, err, 'Could not post the offer')
    }
    posting = false
    drawLow()
  }

  return {
    id: 'post',
    async render(s: Screens, ctx: StationContext): Promise<void> {
      screens = s
      ctxRef = ctx
      await loadCatalog()
      // Species to ask for: your catalog plus anything seen at this station.
      const gallery = stationId ? await trades.getStationGallery(stationId).catch(() => [] as GalleryEntry[]) : []
      const byId = new Map<string, string>()
      for (const [id, c] of catalog) byId.set(id, c.name)
      for (const g of gallery) if (!byId.has(g.speciesId)) byId.set(g.speciesId, g.speciesName)
      knownSpecies = [...byId].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name))
      // Drop picks the ship no longer has (a trade elsewhere, an expedition).
      const inv = inventory(ctx)
      for (const r of Object.keys(offerRes)) offerRes[r] = Math.min(offerRes[r], inv[r] ?? 0)
      const free = new Set(specimens(ctx).filter(x => !x.locked).map(x => x.id))
      offerSamples = offerSamples.filter(id => free.has(id))
      redrawActive = null
      drawTop()
      drawLow()
    },
    clear(): void {
      clearBag(topBag)
      clearBag(lowBag)
      screens = null
    }
  }
}

// =====================================================================================================
// MY TRADES
// =====================================================================================================
function makeMineView(): ViewDefinition {
  const topBag: Bag = []
  const lowBag: Bag = []
  let screens: Screens | null = null
  let ctxRef: StationContext | null = null
  let history: TradeRecord[] = []
  let historyPage = 0
  let working = false

  function drawTop(): void {
    if (!screens || !ctxRef) return
    clearBag(topBag)
    const top = screens.top
    tabs(topBag, top, ctxRef, 'mine')
    const mine = board.filter(t => t.isMe)
    text(topBag, top, -2.6, 0.72, `YOUR OPEN OFFERS HERE  (${mine.length})`, 0.2, DIM, LEFT)
    if (mine.length === 0) text(topBag, top, 0, -0.1, 'You have no open offers at this station', 0.28, MUTED)
    mine.slice(0, 5).forEach((t, i) => {
      const y = 0.45 - i * 0.34
      frame(topBag, top, 0, y, 5.3, 0.3, { fill: Color4.create(0.02, 0.05, 0.12, 0.8) })
      const gives = `GIVING ${listText(t.offered, offerText)}`
      const wants = `FOR ${listText(t.requested, requestText)}`
      text(topBag, top, -2.55, y + 0.07, gives, fitSize(gives, 3.6, 0.17), WHITE, LEFT)
      text(topBag, top, -2.55, y - 0.08, wants, fitSize(wants, 3.6, 0.17), DIM, LEFT)
      text(topBag, top, 1.35, y, daysLeft(t.expiresAt), 0.15, MUTED, RIGHT)
      button(topBag, top, 2.05, y, 0.85, 0.22, working ? '…' : 'CANCEL', 'Cancel this offer', () => void cancel(t), { size: 0.15, variant: working ? 'disabled' : 'magenta' })
    })
    if (mine.length > 5) text(topBag, top, 0, -1.2, `+${mine.length - 5} more`, 0.15, MUTED)
  }

  function drawLow(): void {
    if (!screens) return
    clearBag(lowBag)
    const low = screens.low
    const per = 5
    const pages = Math.max(1, Math.ceil(history.length / per))
    historyPage = Math.min(historyPage, pages - 1)
    text(lowBag, low, -2.65, 0.95, 'TRADE HISTORY  (ALL STATIONS)', 0.2, DIM, LEFT)
    if (history.length === 0) text(lowBag, low, 0, 0, 'No completed trades yet', 0.3, MUTED)
    history.slice(historyPage * per, historyPage * per + per).forEach((h, i) => {
      const y = 0.65 - i * 0.34
      const gave = h.iWasThePoster ? h.offeredSummary : h.requestedSummary
      const got = h.iWasThePoster ? h.requestedSummary : h.offeredSummary
      const other = h.iWasThePoster ? h.accepterUsername : h.posterUsername
      frame(lowBag, low, 0, y, 5.3, 0.3, { fill: Color4.create(0.02, 0.05, 0.12, 0.8) })
      text(lowBag, low, -2.55, y + 0.07, `${shortDate(h.completedAt)}  ·  with ${other}`, 0.17, CYAN, LEFT)
      const line = `gave ${summaryText(gave)}  ·  got ${summaryText(got)}`
      text(lowBag, low, -2.55, y - 0.08, line, fitSize(line, 5.0, 0.16), WHITE, LEFT)
    })
    if (historyPage > 0) button(lowBag, low, 1.2, -1.05, 0.62, 0.2, '‹ PREV', 'Previous page', () => { historyPage--; drawLow() }, { size: 0.15 })
    if (historyPage < pages - 1) button(lowBag, low, 1.95, -1.05, 0.62, 0.2, 'NEXT ›', 'Next page', () => { historyPage++; drawLow() }, { size: 0.15 })
  }

  async function cancel(t: TradeOffer): Promise<void> {
    const ctx = ctxRef
    if (!ctx || working) return
    working = true
    drawTop()
    try {
      await ctx.busy(trades.cancelTrade(t.id))
      ctx.notify('Offer cancelled. Your items are back aboard.', Color4.create(0, 0.9, 1, 1))
    } catch (err) {
      fail(ctx, err, 'Could not cancel')
    }
    working = false
    await afterTrade(ctx)
  }

  return {
    id: 'mine',
    async render(s: Screens, ctx: StationContext): Promise<void> {
      screens = s
      ctxRef = ctx
      const [, h] = await Promise.all([loadBoard(), trades.getTradeHistory().catch(() => [] as TradeRecord[])])
      history = h
      redrawActive = () => drawTop()
      drawTop()
      drawLow()
    },
    clear(): void {
      clearBag(topBag)
      clearBag(lowBag)
      screens = null
    }
  }
}

// =====================================================================================================
// GALLERY
// =====================================================================================================
function makeGalleryView(): ViewDefinition {
  const topBag: Bag = []
  const lowBag: Bag = []
  let screens: Screens | null = null
  let ctxRef: StationContext | null = null
  let entries: GalleryEntry[] = []
  let page = 0
  let selectedId: string | null = null
  const COLS = 4
  const ROWS = 3

  function drawTop(): void {
    if (!screens || !ctxRef) return
    clearBag(topBag)
    const top = screens.top
    tabs(topBag, top, ctxRef, 'gallery')
    text(topBag, top, -2.6, 0.72, `SPECIES TRADED AT THIS STATION  (${entries.length})`, 0.2, DIM, LEFT)
    if (entries.length === 0) text(topBag, top, 0, -0.1, 'No specimens have changed hands here yet', 0.28, MUTED)
    const per = COLS * ROWS
    const pages = Math.max(1, Math.ceil(entries.length / per))
    page = Math.min(page, pages - 1)
    entries.slice(page * per, page * per + per).forEach((e, i) => {
      const x = -1.95 + (i % COLS) * 1.3
      const y = 0.4 - Math.floor(i / COLS) * 0.52
      const sel = e.speciesId === selectedId
      listRow(topBag, top, x, y, 1.22, 0.44, {
        label: e.speciesName,
        sublabel: titleCase(e.rarity),
        selected: sel,
        hover: e.speciesName,
        imageSrc: e.imageUrl,
        onClick: () => { selectedId = e.speciesId; drawTop(); drawLow() }
      })
    })
    if (page > 0) button(topBag, top, 1.2, -1.22, 0.62, 0.2, '‹ PREV', 'Previous page', () => { page--; drawTop() }, { size: 0.15 })
    if (page < pages - 1) button(topBag, top, 1.95, -1.22, 0.62, 0.2, 'NEXT ›', 'Next page', () => { page++; drawTop() }, { size: 0.15 })
  }

  function drawLow(): void {
    if (!screens) return
    clearBag(lowBag)
    const low = screens.low
    const e = entries.find(x => x.speciesId === selectedId)
    if (!e) {
      text(lowBag, low, 0, 0, entries.length ? 'Select a species above' : '', 0.32, MUTED)
      return
    }
    frame(lowBag, low, -1.4, 0, 2.2, 2.1)
    if (e.imageUrl) image(lowBag, low, -1.4, 0, 1.9, 1.9, e.imageUrl)
    else text(lowBag, low, -1.4, 0, 'NO IMAGE', 0.26, MUTED)
    const title = e.speciesName.toUpperCase()
    text(lowBag, low, 0.1, 0.7, title, fitSize(title, 2.5, 0.42, true), CYAN, LEFT)
    const rows: [string, string][] = [
      ['Rarity', titleCase(e.rarity)],
      ['First traded here', shortDate(e.firstSeenAt)],
      ['Brought by', e.contributedBy]
    ]
    rows.forEach(([k, v], i) => {
      text(lowBag, low, 0.1, 0.3 - i * 0.24, k, 0.22, DIM, LEFT)
      text(lowBag, low, 2.6, 0.3 - i * 0.24, v, 0.22, WHITE, RIGHT)
    })
  }

  return {
    id: 'gallery',
    async render(s: Screens, ctx: StationContext): Promise<void> {
      screens = s
      ctxRef = ctx
      entries = stationId ? await trades.getStationGallery(stationId) : []
      redrawActive = null
      drawTop()
      drawLow()
    },
    clear(): void {
      clearBag(topBag)
      clearBag(lowBag)
      screens = null
    }
  }
}

// =====================================================================================================
// the desk
// =====================================================================================================
export function buildTradingPost(): void {
  const desk = createStation({
    id: 'trade',
    ...hubDesk(HUB_DESK_ANGLES.tradingPost),
    views: [makeBoardView(), makePostView(), makeMineView(), makeGalleryView()],
    notify: showNotification
  })

  onGateChanged((gate) => {
    const next = gate.kind === 'aboard' ? gate.stationId : null
    if (next === stationId) return
    stationId = next
    if (stationId) void desk.refresh()
  })

  // Keep the board current while someone is looking at it.
  // Only for someone near enough to read it, one load at a time; the timer keeps running, so walking up refreshes at once
  const at = hubDesk(HUB_DESK_ANGLES.tradingPost).position
  let loading = false
  let timer = 0
  engine.addSystem((dt) => {
    timer += dt
    if (timer < POLL_SECONDS || loading || !playerNear(at)) return
    timer = 0
    const view = desk.currentView()
    if (!stationId || (view !== 'board' && view !== 'mine') || !redrawActive) return
    const redraw = redrawActive
    loading = true
    void loadBoard().then(() => redraw()).catch(() => {}).finally(() => { loading = false })
  })
}
