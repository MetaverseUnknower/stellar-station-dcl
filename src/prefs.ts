// Per-player preferences, the ship's (copied), saved on the server with the ship's own (api.ts get/savePreferences).
// In the station only its own settings are loaded from and saved to the server, under their own names: whether the
// soundtrack and the club's radio are muted. Everything else set here (the galaxy hologram's map view and heat map,
// from code copied from the ship) is kept for the session only, so the station never overwrites the ship's settings
// or picks them up. A missing route or a failed call never blocks the scene.
import * as api from './api'

/** The settings the station keeps between visits. */
const SAVED = new Set(['stationSoundtrackMuted', 'stationRadioMuted'])

let prefs: Record<string, any> = {}
let loaded = false

export async function loadPrefs(): Promise<void> {
  try {
    const all = (await api.getPreferences()) || {}
    for (const key of SAVED) if (all[key] !== undefined && all[key] !== null && prefs[key] === undefined) prefs[key] = all[key]
  } catch {
    // keep the session's
  }
  loaded = true
}

export function getPref<T>(key: string, fallback: T): T {
  const v = prefs[key]
  return v === undefined || v === null ? fallback : (v as T)
}

export function setPref(key: string, value: string | number | boolean | null): void {
  if (value === null) delete prefs[key]; else prefs[key] = value
  if (loaded && SAVED.has(key)) api.savePreferences({ [key]: value }).catch(() => { /* server route may not exist yet; session copy stands */ })
}
