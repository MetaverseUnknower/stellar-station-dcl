// The lounge's beat: one clock for the club lights and the dance floor. It reads AudioAnalysis on the Relay Radio
// stream when that carries real band data, and otherwise runs rebel-radio's BPM clock. rebel-radio found in-world
// that AudioAnalysis on an AudioStream reported nothing (config.ts, STREAM_AUDIO_WATCHDOG_ENABLED), so the clock is
// the expected case; if the explorer ever starts reporting bands, the lights follow the music without a change here.
// The maths is rebel-radio's lib/beat.ts, copied unchanged (./beat.ts).
import { engine, AudioAnalysis } from '@dcl/sdk/ecs'
import { BANDS, DEFAULT_BPM, beatPhase, envelope, smoothBands, hasSignal } from './beat'
import { loungeSpeaker } from './music'

let level = 0 // 0..1: how hard the music is hitting right now
let beats = 0 // beats so far
let live = false // true while AudioAnalysis carries signal
const listeners: ((beat: number) => void)[] = []

export const beatLevel = () => level
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
  // Say which it is (the console): following the stream's audio, or the steady clock. Once it's had a few seconds to
  // hear something, and again whenever it changes.
  let reported: boolean | null = null
  engine.addSystem((dt) => {
    elapsed += dt
    if (elapsed > 5 && live !== reported) {
      reported = live
      console.log(live
        ? '[beat] following the music: the Relay Radio stream reports its audio, so the club lights hit on its bass'
        : `[beat] not hearing the music (the stream reports no audio levels): the club lights run on a steady ${DEFAULT_BPM} BPM clock`)
    }
    const speaker = loungeSpeaker()
    if (speaker && !attached) {
      attached = true
      // As rebel-radio attaches it (stream.ts): everything zero, mode 0.
      AudioAnalysis.create(speaker, { mode: 0, amplitude: 0, band0: 0, band1: 0, band2: 0, band3: 0, band4: 0, band5: 0, band6: 0, band7: 0 })
    }
    const raw = speaker ? AudioAnalysis.getOrNull(speaker) : null
    const incoming = raw ? [raw.band0, raw.band1, raw.band2, raw.band3, raw.band4, raw.band5, raw.band6, raw.band7] : []
    live = hasSignal(incoming)
    if (live) {
      bands = smoothBands(bands, incoming, 0.35)
      level = Math.min(1, (bands[0] + bands[1]) * 0.9) // bass-weighted, as rebel-radio's mast
      if (armed && level > 0.6) {
        armed = false
        fire()
      } else if (level < 0.35) armed = true
    } else {
      const count = Math.floor((elapsed * DEFAULT_BPM) / 60)
      level = envelope(beatPhase(elapsed, DEFAULT_BPM), 4)
      if (count !== beats) fire(count)
    }
  })

  function fire(count?: number): void {
    beats = count ?? beats + 1
    for (const fn of listeners) fn(beats)
  }
}
