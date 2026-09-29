// Relay Radio on the lounge (the hub's top level), fading in as the lift carries you up and out as you leave.
// How the stream is handled comes from rebel-radio's stream.ts, which learned it the hard way:
//   - create the AudioStream at scene load, playing at full volume: created silent it never held its connection,
//     and created later it never decoded;
//   - the explorer may ignore volume writes, so the fade moves the (spatial) source away, and the volume is set too.
// At zero the source sits FADE_LIFT above the lounge, past its hearing distance from anywhere in the station.
import { engine, Entity, Transform, AudioStream } from '@dcl/sdk/ecs'
import { Vector3 } from '@dcl/sdk/math'
import { CENTER, FLOOR_Y } from '../station'
import { startSoundtrack, setSoundtrackContext, setSoundtrackFade, applySavedMute } from '../soundtrack'
import { startRadioNowPlaying } from './radioNow'
import { getPref, setPref, loadPrefs } from '../prefs'
import { onGateChanged } from '../gate'

export const RELAY_RADIO_URL = 'https://relayradio.org/api/live/stream.mp3' // as rebel-radio's STREAM_URL
const LOUNGE = 25 // metres above the deck (build_station_models.py LOUNGE)
const SOURCE_ABOVE_FLOOR = 4 // over the dance floor
const HEARING = 34 // spatialMaxDistance: the whole lounge (its wall is ~29 m out) from over the dance floor
const FADE_LIFT = 45 // at zero the source is this far above its place: out of hearing everywhere
const FADE_FROM = 19 // heights (above the deck) where the fade starts and completes: from above balcony 2 (17)
const FADE_TO = 24.8 //   to standing on the lounge floor
const VOLUME = 1.0

let speakerEntity: Entity | null = null
/** The lounge's stream entity (for the club lights' AudioAnalysis). */
export function loungeSpeaker(): Entity | null {
  return speakerEntity
}

/** How far into the lounge the player is, 0 (below balcony 2, or outside the hub) to 1 (on the lounge floor),
 *  smoothed. The music and the club lights fade with it. */
export function loungeFade(): number {
  const player = Transform.getOrNull(engine.PlayerEntity)
  if (!player) return 0
  const inHub = Math.hypot(player.position.x - CENTER.x, player.position.z - CENTER.z) < 34
  const h = player.position.y - FLOOR_Y
  const t = inHub ? Math.max(0, Math.min(1, (h - FADE_FROM) / (FADE_TO - FADE_FROM))) : 0
  return t * t * (3 - 2 * t) // smoothstep
}

/** The game's soundtrack (soundtrack.ts, the ship's): the space-station theme, always (the player is docked), fading
 *  out as the lounge's radio fades in, so upstairs only the club's music plays. */
function startStationSoundtrack(): void {
  setSoundtrackContext({ docked: true, system: null })
  void startSoundtrack()
  engine.addSystem(() => {
    if (Transform.has(engine.PlayerEntity)) setSoundtrackFade(1 - loungeFade())
  })
}

let radioMuted = false
let radioMuteChanged = false
export const isRadioMuted = () => radioMuted
const RADIO_PREF = 'stationRadioMuted' // remembered between visits (prefs.ts)
/** Mute or unmute the club's radio (the HUD's MUTE in the lounge). The stream keeps playing, silent, so unmuting
 *  picks up live. */
export function toggleRadioMuted(): void {
  radioMuted = !radioMuted
  radioMuteChanged = true
  setPref(RADIO_PREF, radioMuted)
}

/** Once the saved settings have loaded (prefs.ts), take up the saved mute. */
export function applySavedRadioMute(): void {
  const want = getPref<boolean>(RADIO_PREF, false)
  if (want === radioMuted) return
  radioMuted = want
  radioMuteChanged = true
}

const PREFS_WAIT = 8 // seconds: start the music anyway if the saved settings haven't come (or I'm never let aboard)
let musicReady = false // the saved mutes are in: the music may play

export function buildLoungeMusic(): void {
  // The saved mutes (the soundtrack's and the radio's) first, once signed in and aboard, and only then the music, so
  // a muted player never hears it start. The radio's stream connects straight away but stays silent till then.
  let loadedPrefs = false
  const begin = () => {
    if (musicReady) return
    musicReady = true
    applySavedRadioMute()
    radioMuteChanged = true
    startStationSoundtrack()
    applySavedMute()
  }
  onGateChanged((gate) => {
    if (gate.kind !== 'aboard' || loadedPrefs) return
    loadedPrefs = true
    void loadPrefs().then(begin)
  })
  let waited = 0
  engine.addSystem(function prefsWait(dt) {
    waited += dt
    if (musicReady) engine.removeSystem(prefsWait)
    else if (waited >= PREFS_WAIT) begin()
  })
  startRadioNowPlaying()
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
  speakerEntity = speaker

  let shown = -1
  engine.addSystem(() => {
    if (!Transform.has(engine.PlayerEntity)) return
    const gain = radioMuted || !musicReady ? 0 : loungeFade()
    if (!radioMuteChanged && Math.abs(gain - shown) < 0.01 && !(gain === 0 && shown !== 0) && !(gain === 1 && shown !== 1)) return
    radioMuteChanged = false
    shown = gain
    Transform.getMutable(speaker).position = at(gain)
    const stream = AudioStream.getMutableOrNull(speaker)
    if (stream) stream.volume = VOLUME * gain
  })
}
