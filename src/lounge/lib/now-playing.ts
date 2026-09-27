// Pure now-playing logic. MUST NOT import from '@dcl/sdk' — see Global Constraints.
//
// Consumes The Relay's public station metadata (relayradio.org, read-only,
// no key): GET /api/station/overview. The scene runtime has no EventSource,
// so the SSE feed the API also offers is not an option here; this polls, and
// polls SMARTLY — the overview says when the current track started and how
// long it runs, so the next poll is aimed just past the expected change.

export type Track = {
  title: string
  artist: string
  /** The API calls this `label` but documents it as the GENRE. */
  label: string
  startedAt: string
  durationSeconds: number
  trackId: number
}

export type Overview = {
  status: string
  playable: boolean
  revision?: number
  nowPlaying: Track | null
  nextUp?: Track | null
}

/** What the screen shows; two lines, already shaped for a TextShape. */
export type Display = { head: string; body: string }

export const DISPLAY_TUNING: Display = { head: 'NOW PLAYING', body: 'TUNING…' }
export const DISPLAY_OFF_AIR: Display = { head: 'THE RELAY', body: 'OFF AIR' }

/** Regular poll interval when nothing better is known (the API's own guidance). */
export const POLL_FALLBACK_SECONDS = 30
/** Never hammer the API faster than this, whatever the track timing says. */
export const POLL_MIN_SECONDS = 5
/** Aim this far past the expected track end, so the poll sees the NEXT track. */
export const POLL_LEAD_SECONDS = 1.5

/**
 * Shape an overview for the screen.
 *
 * Title and artist are what the author asked for. The API's `label` is the
 * genre, not a record label or a show title, and the docs are explicit that
 * no DJ/show details exist yet — so nothing is inferred beyond the two
 * fields, and nothing is invented when they are missing.
 */
export function formatDisplay(o: Overview | null): Display {
  if (o === null) return DISPLAY_TUNING
  if (!o.playable || o.status !== 'LIVE') return DISPLAY_OFF_AIR
  const t = o.nowPlaying
  if (!t || !t.title) return DISPLAY_TUNING
  const artist = t.artist ? t.artist : ''
  return { head: 'NOW PLAYING', body: artist ? `${t.title}\n${artist}` : t.title }
}

/**
 * Seconds until the next poll, given the overview just received and the
 * time it was received (ms since epoch).
 *
 * If the current track's end is known and lies ahead, poll POLL_LEAD_SECONDS
 * after it — clamped between POLL_MIN_SECONDS (a track ending "now" must not
 * spin the API) and POLL_FALLBACK_SECONDS (long tracks still get the
 * regular refresh the API asks for, and the station clock can drift from
 * the metadata). Anything unparseable falls back to the regular interval.
 */
export function nextPollSeconds(o: Overview | null, nowMs: number): number {
  const t = o?.nowPlaying
  if (!t || !t.startedAt || !(t.durationSeconds > 0)) return POLL_FALLBACK_SECONDS
  const started = Date.parse(t.startedAt)
  if (Number.isNaN(started)) return POLL_FALLBACK_SECONDS
  const endsInSeconds = (started + t.durationSeconds * 1000 - nowMs) / 1000
  const target = endsInSeconds + POLL_LEAD_SECONDS
  return Math.max(POLL_MIN_SECONDS, Math.min(POLL_FALLBACK_SECONDS, target))
}

/**
 * True when `incoming` should replace `current` on the screen. Keeps a
 * newer state from being clobbered by an older response that arrived late
 * (the API's own caveat about overlapping updates), using its `revision`
 * when both carry one.
 */
export function isNewer(current: Overview | null, incoming: Overview): boolean {
  if (current === null) return true
  if (typeof current.revision === 'number' && typeof incoming.revision === 'number') {
    return incoming.revision >= current.revision
  }
  return true
}
