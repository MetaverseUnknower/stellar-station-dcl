// Galaxy Gardeners server calls the station needs. Same request shape as the ship scene's api.ts
// (bearer token, one re-auth on 401).
import { signedFetch } from '~system/SignedFetch'
import { getToken, authenticate } from './auth'

const API_BASE = 'https://galaxygardeners.app'

export type StationStatus = { isDocked: boolean; stationId: string | null; isAdmin?: boolean }
export type StationSummary = { id: string; name: string }
/** walletAddress is present only when the caller is docked at that station; null for non-Decentraland players. */
export type DockedPlayer = { playerId: string; username: string; dockedAt: string; walletAddress?: string | null }

async function apiGet<T>(path: string): Promise<T> {
  const request = () => {
    const token = getToken()
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (token) headers['Authorization'] = `Bearer ${token}`
    return signedFetch({ url: `${API_BASE}${path}`, init: { method: 'GET', headers } })
  }
  let response = await request()
  if (response.status === 401) {
    console.log('[api] Token expired, re-authenticating...')
    await authenticate()
    response = await request()
  }
  if (!response.ok) throw new Error(`API error ${response.status}: ${response.body}`)
  return JSON.parse(response.body) as T
}

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
