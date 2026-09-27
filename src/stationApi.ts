// Galaxy Gardeners server calls the station needs. Same request shape as the ship scene's api.ts
// (bearer token, one re-auth on 401).
import { signedFetch } from '~system/SignedFetch'
import { getToken, authenticate } from './auth'

const API_BASE = 'https://galaxygardeners.app'

export type StationStatus = { isDocked: boolean; stationId: string | null; isAdmin?: boolean }
export type StationSummary = { id: string; name: string }
/** walletAddress is present only when the caller is docked at that station; null for non-Decentraland players. */
export type DockedPlayer = { playerId: string; username: string; dockedAt: string; walletAddress?: string | null }

async function request<T>(method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown): Promise<T> {
  const send = () => {
    const token = getToken()
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (token) headers['Authorization'] = `Bearer ${token}`
    return signedFetch({
      url: `${API_BASE}${path}`,
      init: { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }
    })
  }
  let response = await send()
  if (response.status === 401) {
    console.log('[api] Token expired, re-authenticating...')
    await authenticate()
    response = await send()
  }
  if (!response.ok) {
    // The server's { error } is written for players ("Not enough cargo space: ..."); show it as is.
    let message = `Request failed (${response.status})`
    try {
      message = JSON.parse(response.body).error ?? message
    } catch {
      /* not JSON */
    }
    throw new Error(message)
  }
  return (response.body ? JSON.parse(response.body) : undefined) as T
}

const apiGet = <T>(path: string) => request<T>('GET', path)
const apiPost = <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {})

export function getStationStatus(): Promise<StationStatus> {
  return apiGet('/api/stations/status')
}

export function getDockedPlayers(stationId: string): Promise<DockedPlayer[]> {
  return apiGet(`/api/stations/docked/${encodeURIComponent(stationId)}`)
}

/** Admin only: every station, for the debug station picker. */
export function listStations(): Promise<StationSummary[]> {
  return apiGet('/api/stations/list')
}

// ---- Trading (server: routes/trades.ts) ----

export type TradeItem = {
  id: string
  itemType: 'resource' | 'sample'
  resourceType?: string | null
  quantity?: number | null
  speciesName?: string
  rarity?: string
  sampleRequestMode?: 'specific_species' | 'rarity_tier' | 'open' | null
  requestedMinRarity?: string | null
  requestedSpeciesId?: string
  requestedSpeciesName?: string
}
export type TradeOffer = {
  id: string
  posterId: string
  posterUsername: string
  isMe: boolean
  expiresAt: string
  createdAt: string
  offered: TradeItem[]
  requested: TradeItem[]
}
export type TradeSummary = { samples: { species_name: string | null; rarity: string }[]; resources: { type: string; quantity: number }[] }
export type TradeRecord = {
  id: string
  posterUsername: string
  accepterUsername: string
  offeredSummary: TradeSummary
  requestedSummary: TradeSummary
  completedAt: string
  iWasThePoster: boolean
}
export type GalleryEntry = { speciesId: string; speciesName: string; rarity: string; imageUrl: string | null; contributedBy: string; firstSeenAt: string }
export type OfferedItemInput = { type: 'resource'; resourceType: string; quantity: number } | { type: 'sample'; sampleId: string }
export type RequestedItemInput =
  | { type: 'resource'; resourceType: string; quantity: number }
  | { type: 'sample'; sampleRequestMode: 'open' }
  | { type: 'sample'; sampleRequestMode: 'rarity_tier'; requestedMinRarity: string }
  | { type: 'sample'; sampleRequestMode: 'specific_species'; requestedSpeciesId: string }

export function getStationTrades(stationId: string): Promise<TradeOffer[]> {
  return apiGet(`/api/trades/station/${encodeURIComponent(stationId)}`)
}

export function postTrade(stationId: string, offered: OfferedItemInput[], requested: RequestedItemInput[]): Promise<{ tradeId: string }> {
  return apiPost('/api/trades', { stationId, offered, requested })
}

export function acceptTrade(tradeId: string, fulfilledSamples: { itemId: string; sampleId: string }[]): Promise<{ success: boolean }> {
  return apiPost(`/api/trades/accept/${encodeURIComponent(tradeId)}`, { fulfilledSamples })
}

export function cancelTrade(tradeId: string): Promise<{ status: string }> {
  return apiPost(`/api/trades/cancel/${encodeURIComponent(tradeId)}`)
}

export function getTradeHistory(): Promise<TradeRecord[]> {
  return apiGet('/api/trades/history')
}

export function getStationGallery(stationId: string): Promise<GalleryEntry[]> {
  return apiGet(`/api/trades/gallery/${encodeURIComponent(stationId)}`)
}

// ---- Notice board (server: routes/board.ts) ----

export type BoardReply = { id: string; authorId: string; authorUsername: string; body: string; createdAt: string; isMe: boolean }
export type BoardPost = BoardReply & { pinned: boolean; replies: BoardReply[] }
export type Board = { canModerate: boolean; posts: BoardPost[] }

export function getBoard(stationId: string): Promise<Board> {
  return apiGet(`/api/board/${encodeURIComponent(stationId)}`)
}

export function postToBoard(stationId: string, body: string, parentId?: string): Promise<BoardReply> {
  return apiPost(`/api/board/${encodeURIComponent(stationId)}`, { body, parentId })
}

export function deleteBoardPost(postId: string): Promise<{ deleted: boolean }> {
  return request('DELETE', `/api/board/post/${encodeURIComponent(postId)}`)
}

export function pinBoardPost(postId: string, pinned: boolean): Promise<{ pinned: boolean }> {
  return apiPost(`/api/board/post/${encodeURIComponent(postId)}/pin`, { pinned })
}

/** Reports a player to the moderators (server: routes/reports.ts); context says what and where. */
export function reportPlayer(reportedPlayerId: string, reason: string, context: string): Promise<{ reportId: string }> {
  return apiPost('/api/reports', { reportedPlayerId, reason, context })
}

// ---- Leaderboards (server: routes/leaderboards.ts) ----

export type LeaderboardEntry = { rank: number; playerId: string; username: string; value: number; isMe: boolean }
export type LeaderboardCategory = { key: string; label: string; top: LeaderboardEntry[]; me: { rank: number; value: number } | null }
export type Leaderboards = { galaxyId: string; refreshedAt: string | null; categories: LeaderboardCategory[] }

export function getLeaderboards(): Promise<Leaderboards> {
  return apiGet('/api/leaderboards')
}
