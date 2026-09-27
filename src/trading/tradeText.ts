// Trading Post text and rules shared by its views: how items read on screen, and which of the player's specimens
// can fill a requested one (the same rules the server's accept_trade applies).
import { titleCase } from '../stations/data'
import { TradeItem, TradeSummary } from '../stationApi'

export const RARITY_ORDER = ['common', 'uncommon', 'rare', 'legendary', 'mythic']
export const RESOURCE_TYPES = [
  'iron_ore', 'copper_ore', 'helium_3', 'titanium', 'plasma_crystals',
  'quantum_alloy', 'dark_matter', 'void_essence', 'singularity_fragment'
]

/** A vault specimen with its species' name and rarity (from the player's catalog). */
export type Specimen = { id: string; speciesId: string; name: string; rarity: string; body: string; locked: boolean }

export function resourceName(type: string | null | undefined): string {
  return titleCase(type ?? 'unknown')
}

export function requestText(item: TradeItem): string {
  if (item.itemType === 'resource') return `${item.quantity ?? 0} ${resourceName(item.resourceType)}`
  if (item.sampleRequestMode === 'specific_species') return `${item.requestedSpeciesName ?? 'a specific'} specimen`
  if (item.sampleRequestMode === 'rarity_tier') return `any ${titleCase(item.requestedMinRarity ?? 'common')}+ specimen`
  return 'any specimen'
}

export function offerText(item: TradeItem): string {
  if (item.itemType === 'resource') return `${item.quantity ?? 0} ${resourceName(item.resourceType)}`
  return `${item.speciesName ?? 'Unknown'} (${titleCase(item.rarity ?? 'common')})`
}

export function listText(items: TradeItem[], describe: (i: TradeItem) => string): string {
  return items.map(describe).join(', ')
}

export function summaryText(sum: TradeSummary | null | undefined): string {
  if (!sum) return 'nothing'
  const parts = [
    ...(sum.resources ?? []).map(r => `${r.quantity} ${resourceName(r.type)}`),
    ...(sum.samples ?? []).map(s => s.species_name ?? 'a specimen')
  ]
  return parts.length ? parts.join(', ') : 'nothing'
}

/** Specimens that satisfy one requested item: unlocked, and matching its species or minimum rarity. */
export function matchesRequest(s: Specimen, item: TradeItem): boolean {
  if (s.locked) return false
  if (item.sampleRequestMode === 'specific_species') return s.speciesId === item.requestedSpeciesId
  if (item.sampleRequestMode === 'rarity_tier') {
    return RARITY_ORDER.indexOf(s.rarity) >= RARITY_ORDER.indexOf(item.requestedMinRarity ?? 'common')
  }
  return true
}

export function daysLeft(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now()
  if (ms <= 0) return 'expiring'
  const h = Math.floor(ms / 3_600_000)
  return h >= 24 ? `${Math.floor(h / 24)}d left` : `${Math.max(1, h)}h left`
}

export function shortDate(iso: string): string {
  const d = new Date(iso)
  const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']
  return `${months[d.getUTCMonth()]} ${d.getUTCDate()}`
}
