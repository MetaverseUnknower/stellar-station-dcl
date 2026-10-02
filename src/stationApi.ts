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
    // The server's { error } is written for players ("Not enough cargo space: ..."); show it as is. The Decentraland
    // client unwraps it before we see it: on an error reply the body is already the `error` string, not the JSON
    // (unity-explorer SignedFetchWrap.cs), so a body that isn't JSON is the message itself.
    let message = `Request failed (${response.status})`
    try {
      message = JSON.parse(response.body).error ?? message
    } catch {
      if (response.body) message = response.body
    }
    throw Object.assign(new Error(message), { status: response.status })
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

// ---- the arcade's high scores (server routes/arcade.ts) ----

export type ArcadeEntry = { name: string; score: number }
export type ArcadeTables = { games: Record<string, { top: ArcadeEntry[]; mine: number }> }

/** Each game's top five at this station, and my own best at each. */
export function getArcadeScores(stationId: string): Promise<ArcadeTables> {
  return request('GET', `/api/arcade/${stationId}`)
}

/** A game over: kept if it beats my best at this game here. */
export function postArcadeScore(stationId: string, game: string, score: number): Promise<{ best: number; improved: boolean }> {
  return request('POST', `/api/arcade/${stationId}/${game}`, { score })
}

// ---- the black market (server routes/blackMarket.ts) ----

export type MarketItem = {
  id: string
  name: string
  mana: number
  blurb: string
  kind: 'wormhole' | 'destroy' | 'rename' | 'cloak' | 'radio' | 'insurance' | 'map'
  hours: number | null
  exclusive: boolean
}
export type MarketParams = { targetSystemId?: string; systemId?: string; guests?: string[]; name?: string; message?: string }
export type MarketPending = { txHash: string; item: string; params: MarketParams }
/** A purchase's outcome: done, still waiting for Polygon, or refused with the server's words (`final`: stop asking). */
export type MarketBuyResult =
  | { status: 'ok'; summary: string }
  | { status: 'pending' }
  | { status: 'error'; message: string; final: boolean }
export type Friend = { playerId: string; username: string }

export function getMarketCatalog(): Promise<{ items: MarketItem[] }> {
  return apiGet('/api/black-market/catalog')
}

/** Whether a purchase can go ahead, and what it will do. Throws the dealer's refusal. */
export function quoteMarket(item: string, params: MarketParams): Promise<{ summary: string; mana: number }> {
  return apiPost('/api/black-market/quote', { item, params })
}

/** Payments sent but not yet settled (to pick one up again after a reload). */
export function getMarketPending(): Promise<{ pending: MarketPending[] }> {
  return apiGet('/api/black-market/pending')
}

/** `wormholeMap` is missing from a server older than the map. */
export function getMarketMine(): Promise<{ cloakedUntil: string | null; insurancePolicies: number; wormholeMap?: boolean }> {
  return apiGet('/api/black-market/mine')
}

export function getPirateRadio(): Promise<{ broadcast: { message: string; by: string; endsAt: string } | null }> {
  return apiGet('/api/black-market/radio')
}

// ---- the Eld's wormhole map (server services/blackMarket/wormholeMap.ts), for players who bought it ----

export type MapStar = { id: string; name: string }
export type MapEvent = {
  id: string
  target: MapStar
  startsAt: string
  endsAt: string
  status: 'open' | 'scheduled'
  exclusive: boolean
  eldBuilt: boolean
}
export type WormholeMap = { links: { a: MapStar; b: MapStar }[]; dormant: MapStar[]; events: MapEvent[] }

/** Every known wormhole in my galaxy, or null when I don't own the map (the server's 403). */
export async function getWormholeMap(): Promise<WormholeMap | null> {
  try {
    return await apiGet<WormholeMap>('/api/black-market/wormhole-map')
  } catch (e) {
    // Only the server's own "not owned" 403: the auth middleware answers a different 403 ("No player account found") when
    // its player lookup fails transiently, and that must not read as "not owned".
    const err = e as { status?: number; message?: string }
    if (err.status === 403 && err.message === 'not owned') return null
    throw e
  }
}

// ---- friends (server routes/friends.ts) ----

export type FriendRequestIn = { friendshipId: string; fromPlayerId: string; fromUsername: string }
export type FriendRequestOut = { friendshipId: string; toPlayerId: string; toUsername: string }
export type FriendsList = { friends: Friend[]; incomingRequests: FriendRequestIn[]; outgoingRequests: FriendRequestOut[] }

export function getFriends(): Promise<FriendsList> {
  return apiGet('/api/friends')
}

/** Send a request by friend code (or accept theirs, if they'd already asked). */
export function requestFriendByCode(friendCode: string): Promise<{ status: string; message?: string }> {
  return apiPost('/api/friends/request', { friendCode })
}

/** Send a request to a player docked at my station. */
export function requestDockedFriend(playerId: string): Promise<{ status: string; message?: string }> {
  return apiPost('/api/friends/request-docked', { playerId })
}

export function acceptFriend(friendshipId: string): Promise<{ status: string }> {
  return apiPost(`/api/friends/accept/${encodeURIComponent(friendshipId)}`)
}

export function rejectFriend(friendshipId: string): Promise<unknown> {
  return apiPost(`/api/friends/reject/${encodeURIComponent(friendshipId)}`)
}

/**
 * Settle a payment. Unlike the rest, this reads the status itself: 202 is "not mined yet, ask again", and a network
 * error or a 5xx isn't the end either (the MANA is already sent), while 400/402/409 are the server's last word.
 */
export async function buyFromMarket(item: string, params: MarketParams, txHash: string): Promise<MarketBuyResult> {
  try {
    const body = await request<{ status?: string; summary?: string }>('POST', '/api/black-market/buy', { item, params, txHash })
    if (body?.status === 'ok') return { status: 'ok', summary: body.summary ?? 'Done.' }
    return { status: 'pending' }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    const status = (e as { status?: number })?.status
    return { status: 'error', message, final: status === 400 || status === 402 || status === 409 }
  }
}
