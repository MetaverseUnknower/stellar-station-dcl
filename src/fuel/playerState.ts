// Galaxy Gardeners — The player's registration status with the game server, shared by FERN and the fuel dispenser.
import { authenticate } from '../auth'

export type PlayerStatus = 'unknown' | 'new' | 'returning'

let status: PlayerStatus = 'unknown'
let inFlight: Promise<PlayerStatus> | null = null

export function getPlayerStatus(): PlayerStatus {
  return status
}

export function setPlayerStatus(next: PlayerStatus): void {
  status = next
}

/**
 * Single-flight sign-in. While status is 'unknown' this calls authenticate() and sets
 * 'returning'/'new' from hasPlayer. Concurrent callers share the same in-flight attempt.
 * On error the status stays 'unknown', the failure is logged, and the promise is cleared
 * so a later call can retry. Once status is known it returns immediately.
 */
export async function ensurePlayerStatus(): Promise<PlayerStatus> {
  if (status !== 'unknown') return status
  if (!inFlight) {
    inFlight = (async () => {
      try {
        const { hasPlayer } = await authenticate()
        setPlayerStatus(hasPlayer ? 'returning' : 'new')
      } catch (e) {
        console.log(`[player] sign-in failed: ${e}`)
      } finally {
        inFlight = null
      }
      return status
    })()
  }
  return inFlight
}
