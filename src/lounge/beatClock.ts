// The lounge's beat: one clock for the club lights and the dance floor. It reads AudioAnalysis on the Relay Radio
// stream when that carries real band data, and otherwise runs rebel-radio's BPM clock. rebel-radio found in-world
// that AudioAnalysis on an AudioStream reported nothing (config.ts, STREAM_AUDIO_WATCHDOG_ENABLED), so the clock is
// the expected case; if the explorer ever starts reporting bands, the lights follow the music without a change here.
// The maths is rebel-radio's lib/beat.ts, copied unchanged (./beat.ts).
import { engine, AudioAnalysis } from '@dcl/sdk/ecs'
import { BANDS, DEFAULT_BPM, beatPhase, envelope, smoothBands, hasSignal } from './beat'
import { loungeSpeaker } from './music'

let level = 0 // 0..1: the bass (the kick): how hard the music is hitting right now
let mid = 0 // 0..1: the middle of the spectrum (snares, synths, voices)
let high = 0 // 0..1: the top (hats, cymbals, shimmer)
let beats = 0 // beats so far
let live = false // true while AudioAnalysis carries signal
const PEAK_DECAY = 0.85 // per second: how fast a part's remembered peak sinks, so a quiet passage still moves the lights
const PEAK_FLOOR = 0.02 // below this, it's silence, not a quiet passage to scale up
const listeners: ((beat: number) => void)[] = []

export const beatLevel = () => level
/** The mids, 0..1 (the chandelier's ripple, the lasers' turn). */
export const midLevel = () => mid
/** The highs, 0..1 (the lasers' shimmer, the mirror ball's sparkle). */
export const highLevel = () => high
export const beatCount = () => beats
export const isLiveAnalysis = () => live
/** Called on every beat (a hit in the bass, or the clock's beat). */
export function onBeat(fn: (beat: number) => void): void {
  listeners.push(fn)
}

export function startBeatClock(): void {
  let elapsed = 0
  let bands: number[] = new Array(BANDS).fill(0)
  let attached = false
  let armed = true // a live hit counts once, until the level falls back
  let peaks = [PEAK_FLOOR, PEAK_FLOOR, PEAK_FLOOR] // bass, mids, highs: each one's recent loudest
  // Say which it is (the console): following the stream's audio, or the steady clock. Once it's had a few seconds to
  // hear something, and again whenever it changes.
  let reported: boolean | null = null
  engine.addSystem((dt) => {
    elapsed += dt
    if (elapsed > 5 && live !== reported) {
      reported = live
      console.log(live
        ? '[beat] following the music: the Relay Radio stream reports its audio, so the club lights follow its bass, mids and highs'
        : `[beat] not hearing the music (the stream reports no audio levels): the club lights run on a steady ${DEFAULT_BPM} BPM clock`)
    }
    const speaker = loungeSpeaker()
    if (speaker && !attached) {
      attached = true
      // The SDK's analysis for visuals: logarithmic bands (8, low to high) and amplitude
      AudioAnalysis.createOrReplaceAudioAnalysis(speaker)
    }
    const raw = speaker ? AudioAnalysis.getOrNull(speaker) : null
    const incoming = raw ? [raw.band0, raw.band1, raw.band2, raw.band3, raw.band4, raw.band5, raw.band6, raw.band7] : []
    live = hasSignal(incoming)
    if (live) {
      // Three parts of the spectrum, each against its own recent peak (so the lights use their range on quiet tracks
      // and loud, whatever scale the explorer's numbers come in): bass the lowest two bands, mids the next three,
      // highs the top three
      bands = smoothBands(bands, incoming, 0.45)
      const avg = (a: number, b: number) => bands.slice(a, b).reduce((s, x) => s + x, 0) / (b - a)
      const decay = Math.pow(PEAK_DECAY, dt)
      peaks = peaks.map((p, i) => Math.max([avg(0, 2), avg(2, 5), avg(5, 8)][i], p * decay, PEAK_FLOOR))
      level = Math.min(1, avg(0, 2) / peaks[0])
      mid = Math.min(1, avg(2, 5) / peaks[1])
      high = Math.min(1, avg(5, 8) / peaks[2])
      // A kick: the bass jumping up past most of its peak, counted once until it falls back
      if (armed && level > 0.75) {
        armed = false
        fire()
      } else if (level < 0.45) armed = true
    } else {
      // No audio: a steady clock standing in for all three (a kick on the beat, the mids on the off-beat, the highs
      // on the eighths)
      const count = Math.floor((elapsed * DEFAULT_BPM) / 60)
      level = envelope(beatPhase(elapsed, DEFAULT_BPM), 4)
      mid = 0.6 * envelope(beatPhase(elapsed + 30 / DEFAULT_BPM, DEFAULT_BPM), 5)
      high = 0.5 * envelope(beatPhase(elapsed, DEFAULT_BPM * 2), 7)
      if (count !== beats) fire(count)
    }
  })

  function fire(count?: number): void {
    beats = count ?? beats + 1
    for (const fn of listeners) fn(beats)
  }
}
