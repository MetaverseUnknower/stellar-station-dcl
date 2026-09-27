// Relay Radio on the lounge (the hub's top level), fading in as the lift carries you up and out as you leave.
// How the stream is handled comes from rebel-radio's stream.ts, which learned it the hard way:
//   - create the AudioStream at scene load, playing at full volume: created silent it never held its connection,
//     and created later it never decoded;
//   - the explorer may ignore volume writes, so the fade moves the (spatial) source away, and the volume is set too.
// At zero the source sits FADE_LIFT above the lounge, past its hearing distance from anywhere in the station.
import { engine, Transform, AudioStream } from '@dcl/sdk/ecs'
import { Vector3 } from '@dcl/sdk/math'
import { CENTER, FLOOR_Y } from '../station'

export const RELAY_RADIO_URL = 'https://relayradio.org/api/live/stream.mp3' // as rebel-radio's STREAM_URL
const LOUNGE = 25 // metres above the deck (build_station_models.py LOUNGE)
const SOURCE_ABOVE_FLOOR = 4 // over the dance floor
const HEARING = 34 // spatialMaxDistance: the whole lounge (its wall is ~29 m out) from over the dance floor
const FADE_LIFT = 45 // at zero the source is this far above its place: out of hearing everywhere
const FADE_FROM = 19 // heights (above the deck) where the fade starts and completes: from above balcony 2 (17)
const FADE_TO = 24.8 //   to standing on the lounge floor
const VOLUME = 1.0

export function buildLoungeMusic(): void {
  const base = () => Vector3.create(CENTER.x, FLOOR_Y + LOUNGE + SOURCE_ABOVE_FLOOR, CENTER.z)
  const at = (gain: number) => {
    const b = base()
    return Vector3.create(b.x, b.y + FADE_LIFT * (1 - gain), b.z)
  }
  const speaker = engine.addEntity()
  Transform.create(speaker, { position: at(0) })
  AudioStream.create(speaker, {
    url: RELAY_RADIO_URL,
    playing: true,
    volume: VOLUME,
    spatial: true,
    spatialMinDistance: 8,
    spatialMaxDistance: HEARING
  })

  let shown = -1
  engine.addSystem(() => {
    const player = Transform.getOrNull(engine.PlayerEntity)
    if (!player) return
    const inHub = Math.hypot(player.position.x - CENTER.x, player.position.z - CENTER.z) < 34
    const h = player.position.y - FLOOR_Y
    const t = inHub ? Math.max(0, Math.min(1, (h - FADE_FROM) / (FADE_TO - FADE_FROM))) : 0
    const gain = t * t * (3 - 2 * t) // smoothstep
    if (Math.abs(gain - shown) < 0.01 && !(gain === 0 && shown !== 0) && !(gain === 1 && shown !== 1)) return
    shown = gain
    Transform.getMutable(speaker).position = at(gain)
    const stream = AudioStream.getMutableOrNull(speaker)
    if (stream) stream.volume = VOLUME * gain
  })
}
