// Pure beat/analysis math. MUST NOT import from '@dcl/sdk' — see Global Constraints.

export const DEFAULT_BPM = 124
export const BANDS = 8
const SIGNAL_THRESHOLD = 0.01

/** Position within the current beat, 0..1. */
export function beatPhase(elapsedSeconds: number, bpm: number): number {
  if (!isFinite(bpm) || bpm <= 0) return 0
  const beatLength = 60 / bpm
  const phase = (elapsedSeconds % beatLength) / beatLength
  return phase < 0 ? phase + 1 : phase
}

/** Emissive envelope: 1 on the beat, decaying across it. */
export function envelope(phase: number, decay: number): number {
  const v = Math.exp(-phase * decay)
  return v < 0 ? 0 : v
}

export function smoothBands(prev: number[], next: number[], alpha: number): number[] {
  const out: number[] = []
  for (let i = 0; i < prev.length; i++) {
    const target = next[i] ?? 0
    out[i] = prev[i] + (target - prev[i]) * alpha
  }
  return out
}

/**
 * True when band data carries real energy.
 *
 * The Explorer returns all zeros from AudioAnalysis for VideoPlayer entities
 * (confirmed renderer bug — AVPro bypasses Unity's audio pipeline). Whether
 * AudioStream is affected is unverified, so every consumer checks this and
 * falls back to the BPM clock rather than rendering a dead light rig.
 */
export function hasSignal(bands: number[], threshold: number = SIGNAL_THRESHOLD): boolean {
  if (bands.length === 0) return false
  for (const b of bands) {
    if (b > threshold) return true
  }
  return false
}
