// What Relay Radio is playing, for the club's HUD bar (ui.tsx). Polls The Relay's public station overview
// (relayradio.org /api/station/overview, no key), as rebel-radio's src/nowPlaying.ts does: the parsing and the poll
// timing are its lib/now-playing.ts, copied unchanged (./lib/now-playing.ts); the next poll is aimed just past the
// current track's end. Only polls while the player is in or climbing to the lounge.
import { engine } from '@dcl/sdk/ecs'
import { formatDisplay, nextPollSeconds, isNewer, Display, Overview, POLL_FALLBACK_SECONDS } from './lib/now-playing'
import { loungeFade } from './music'

const STATION_OVERVIEW_URL = 'https://relayradio.org/api/station/overview' // rebel-radio's config.ts
const FETCH_TIMEOUT_MS = 8000

let current: Overview | null = null
let secondsUntilPoll = 0
let inFlight = false

/** What to show: rebel-radio's two lines ("NOW PLAYING" and "title\nartist"; or tuning, or off air). */
export const radioDisplay = (): Display => formatDisplay(current)
/** The genre of what's playing (the API's `label`), or null. */
export const radioGenre = (): string | null => current?.nowPlaying?.label || null
/** Whether the player is up where the radio plays (and the bar should show it). */
export const inTheClub = () => loungeFade() > 0.5

async function poll() {
  inFlight = true
  try {
    const res = await fetch(STATION_OVERVIEW_URL, { timeout: FETCH_TIMEOUT_MS } as any)
    if (!res.ok) throw new Error(`overview returned HTTP ${res.status}`)
    const incoming = (await res.json()) as Overview
    if (isNewer(current, incoming)) current = incoming
    secondsUntilPoll = nextPollSeconds(current, Date.now())
  } catch (e) {
    // Keep the last valid display and keep polling (the API's own guidance).
    console.log(`[relay now-playing] ${e instanceof Error ? e.message : String(e)}`)
    secondsUntilPoll = POLL_FALLBACK_SECONDS
  } finally {
    inFlight = false
  }
}

export function startRadioNowPlaying(): void {
  engine.addSystem((dt: number) => {
    if (inFlight || loungeFade() <= 0) return
    secondsUntilPoll -= dt
    if (secondsUntilPoll <= 0) void poll()
  })
}
