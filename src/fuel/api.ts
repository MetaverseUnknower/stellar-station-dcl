import { signedFetch } from '~system/SignedFetch'
import { getToken, authenticate } from '../auth' // the station's sign-in (the landing build's own auth.ts, less its display name)
import { API_BASE } from './config'

async function makeRequest(
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string }
): Promise<{ ok: boolean; status: number; body: string }> {
  const response = await signedFetch({ url, init })

  if (response.status === 401) {
    console.log('[api] Token expired, re-authenticating...')
    await authenticate()
    const newToken = getToken()
    if (newToken) {
      init.headers['Authorization'] = `Bearer ${newToken}`
    }
    return await signedFetch({ url, init })
  }

  return response
}

async function apiGet<T>(path: string): Promise<T> {
  const token = getToken()
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  const response = await makeRequest(`${API_BASE}${path}`, { method: 'GET', headers })

  if (!response.ok) {
    throw new Error(`API error ${response.status}: ${response.body}`)
  }

  return JSON.parse(response.body) as T
}

async function apiPost<T>(path: string, body?: Record<string, unknown>): Promise<T> {
  const token = getToken()
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  const response = await makeRequest(`${API_BASE}${path}`, {
    method: 'POST',
    headers,
    body: body ? JSON.stringify(body) : undefined
  })

  if (!response.ok) {
    throw new Error(`API error ${response.status}: ${response.body}`)
  }

  if (!response.body) return undefined as T
  return JSON.parse(response.body) as T
}

export async function getAvailableGalaxies(): Promise<{ id: string }[]> {
  return apiGet<{ id: string }[]>('/api/galaxy/available')
}

export async function joinGalaxy(galaxyId: string, username: string): Promise<{ playerId: string; homeSystemId: string }> {
  return apiPost(`/api/galaxy/${galaxyId}/join`, { username })
}

// ── Fuel drops ──
// Claim and redeem return an outcome instead of throwing, so the panel can show player copy for every case.

export type DropStatus =
  | 'ok'
  | 'already_claimed'
  | 'sold_out'
  | 'expired'
  | 'not_started'
  | 'ineligible'
  | 'no_ship'
  | 'not_found'
  | 'guest'
  | 'unauthorized'
  | 'rate_limited'
  | 'dispenser_off'
  | 'error'

export interface DropResult {
  status: DropStatus
  cells?: number
  fuelCells?: number
}

export interface SceneDrop {
  id: string
  name: string
  cells: number
}

async function apiSend(path: string, body: Record<string, unknown>): Promise<{ status: number; body: string }> {
  const token = getToken()
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }
  const response = await makeRequest(`${API_BASE}${path}`, { method: 'POST', headers, body: JSON.stringify(body) })
  return { status: response.status, body: response.body }
}

function parseDropResult(res: { status: number; body: string }): DropResult {
  try {
    const parsed = JSON.parse(res.body) as Partial<DropResult>
    if (typeof parsed.status === 'string') return parsed as DropResult
  } catch {
    // fall through to a status-code guess
  }
  return { status: res.status === 429 ? 'rate_limited' : 'error' }
}

export async function getSceneDrop(): Promise<{ drop: SceneDrop | null; claimed: boolean; dispenserEnabled?: boolean }> {
  return apiGet('/api/drops/scene')
}

export async function claimSceneDrop(dropId: string): Promise<DropResult> {
  return parseDropResult(await apiSend('/api/drops/scene/claim', { dropId }))
}

export async function redeemFuelCode(code: string): Promise<DropResult> {
  return parseDropResult(await apiSend('/api/drops/redeem', { code }))
}

// ── Operator dispenser switch ──
// The server checks the caller's wallet against its operator list; 401/403 come back as { status }.

export type DispenserSwitchResult = { ok: true; dispenserEnabled: boolean } | { ok: false; status: string }

export async function setDispenserEnabled(on: boolean): Promise<DispenserSwitchResult> {
  const res = await apiSend(`/api/drops/dispenser/${on ? 'on' : 'off'}`, {})
  try {
    const parsed = JSON.parse(res.body) as { dispenserEnabled?: unknown; status?: unknown }
    if (res.status >= 200 && res.status < 300 && typeof parsed.dispenserEnabled === 'boolean') {
      return { ok: true, dispenserEnabled: parsed.dispenserEnabled }
    }
    if (typeof parsed.status === 'string') return { ok: false, status: parsed.status }
  } catch {
    // fall through
  }
  return { ok: false, status: res.status === 401 ? 'unauthorized' : res.status === 403 ? 'forbidden' : 'error' }
}

// ── Fuel cell store (MANA) ──
// 202 { status: 'pending' } while Polygon hasn't confirmed the transfer, 200 { status: 'ok', fuelCells } once credited.
// Any non-2xx throws "API error <code>: <body>" so paymentErrorMessage can surface the server's `error` message.

export async function purchaseFuelCellsMana(tier: string, txHash: string): Promise<{ status: 'ok' | 'pending'; fuelCells?: number }> {
  return apiPost('/api/store/purchase-fuel-cells-mana', { tier, txHash })
}

/**
 * Any MANA purchase the server saw a 202 for but hasn't confirmed credited yet, for the caller's wallet. Used to
 * resume a purchase after a scene reload wiped the in-memory record. Returns `[]` on any error, including 404 —
 * staging may not have this route yet.
 */
export async function getPendingManaPurchases(): Promise<{ tier: string; txHash: string }[]> {
  try {
    const result = await apiGet<{ pending?: { tier: string; txHash: string }[] }>('/api/store/mana-pending')
    return Array.isArray(result?.pending) ? result.pending : []
  } catch {
    return []
  }
}
