// Station HUD: gate status while signing in or being sent back, the crew docked here, and the way home.
// Sizes are authored at 1080 px tall and scaled with px() (see uiScale.ts).
import ReactEcs, { ReactEcsRenderer, UiEntity, Label } from '@dcl/sdk/react-ecs'
import { Color4 } from '@dcl/sdk/math'
import { px } from './uiScale'
import { getGateState, returnToShip, isAdmin, getStations, pickStation } from './gate'
import { ShipDialogs } from './shipDialogs'
import { ComposePanel } from './board/compose'
import { liftPanel } from './lift/lifts'
import { standingAtAirlock } from './airlock'
import { InvadersScreen } from './arcade/invaders/hud'
import { GardenScreen } from './arcade/garden/hud'
import { BreakerScreen } from './arcade/breaker/hud'
import { CometScreen } from './arcade/comet/hud'
import { DriftScreen } from './arcade/drift/hud'
import { OrbitScreen } from './arcade/orbit/hud'
import { RacerScreen } from './arcade/racer/hud'
import { FuelPanel } from './fuel/fuelPanelUi'
import { currentTrack, isMuted, toggleMuted, nextTrack } from './soundtrack'
import { radioDisplay, radioGenre, inTheClub } from './lounge/radioNow'
import { isRadioMuted, toggleRadioMuted } from './lounge/music'

// stations/shipOverview.ts (copied from the ship) opens these from '../ui', as on the ship.
export { openRefineryDialog, openPurchaseDialog, openRecallDialog } from './shipDialogs'

const PANEL = Color4.create(0.02, 0.06, 0.12, 0.85)
const CYAN = Color4.create(0, 0.9, 1, 1)
const DIM = Color4.create(0.6, 0.7, 0.8, 1)
const AMBER = Color4.create(1, 0.75, 0.2, 1)
const WARN = Color4.create(1, 0.55, 0.4, 1)

function StatusBanner() {
  const gate = getGateState()
  if (gate.kind === 'aboard') return null
  const text = gate.kind === 'checking' ? 'Checking your docking clearance...' : gate.reason
  return (
    <UiEntity
      uiTransform={{ positionType: 'absolute', position: { top: px(80) }, width: '100%', justifyContent: 'center' }}
    >
      <UiEntity
        uiTransform={{ padding: px(20), flexDirection: 'column', alignItems: 'center' }}
        uiBackground={{ color: PANEL }}
      >
        <Label value={text} fontSize={px(26)} color={gate.kind === 'checking' ? CYAN : WARN} />
        {gate.kind === 'refused' && (
          <UiEntity
            uiTransform={{ margin: { top: px(12) }, padding: px(10), width: px(260), justifyContent: 'center' }}
            uiBackground={{ color: CYAN }}
            onMouseDown={() => returnToShip('Returning to your ship.')}
          >
            <Label value="RETURN TO SHIP" fontSize={px(20)} color={Color4.Black()} />
          </UiEntity>
        )}
      </UiEntity>
    </UiEntity>
  )
}

const ADMIN_PAGE = 8 // stations listed at a time
let adminCollapsed = false
let adminPage = 0

/** Admin-only debug panel: every station, in pages; picking one switches whose players you see. Folds away. */
function AdminPanel() {
  const gate = getGateState()
  if (!isAdmin() || gate.kind !== 'aboard') return null
  const stations = getStations()
  const pages = Math.max(1, Math.ceil(stations.length / ADMIN_PAGE))
  adminPage = Math.min(adminPage, pages - 1)
  const shown = stations.slice(adminPage * ADMIN_PAGE, (adminPage + 1) * ADMIN_PAGE)
  const current = stations.find((s) => s.id === gate.stationId)
  const button = (key: string, text: string, enabled: boolean, onClick: () => void) => (
    <UiEntity
      key={key}
      uiTransform={{ width: px(40), height: px(30), justifyContent: 'center', alignItems: 'center', margin: { left: px(6) } }}
      uiBackground={{ color: enabled ? Color4.create(1, 1, 1, 0.12) : Color4.create(1, 1, 1, 0.04) }}
      onMouseDown={() => { if (enabled) onClick() }}
    >
      <Label value={text} fontSize={px(16)} color={enabled ? CYAN : Color4.create(0.4, 0.45, 0.55, 1)} />
    </UiEntity>
  )
  return (
    <UiEntity
      uiTransform={{
        positionType: 'absolute',
        position: { left: px(24), top: px(200) },
        width: px(300),
        padding: px(adminCollapsed ? 10 : 16),
        flexDirection: 'column'
      }}
      uiBackground={{ color: PANEL }}
    >
      {/* Header: the title, and a toggle to fold the panel away. */}
      <UiEntity uiTransform={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', height: px(30) }}>
        <Label value={`ADMIN  ·  STATIONS (${stations.length})`} fontSize={px(18)} color={WARN} textAlign="middle-left" />
        {button('fold', adminCollapsed ? '+' : '–', true, () => { adminCollapsed = !adminCollapsed })}
      </UiEntity>
      {!adminCollapsed && (
        <UiEntity uiTransform={{ flexDirection: 'column' }}>
          <Label value={`AT  ${current ? current.name : '—'}`} fontSize={px(14)} color={DIM} textAlign="middle-left" uiTransform={{ height: px(22), margin: { top: px(4) } }} />
          {shown.map((s) => {
            const here = s.id === gate.stationId
            return (
              <UiEntity
                key={s.id}
                uiTransform={{ height: px(34), margin: { top: px(4) }, padding: { left: px(10) }, alignItems: 'center' }}
                uiBackground={{ color: here ? CYAN : Color4.create(1, 1, 1, 0.08) }}
                onMouseDown={() => pickStation(s.id)}
              >
                <Label value={s.name} fontSize={px(17)} color={here ? Color4.Black() : DIM} textAlign="middle-left" />
              </UiEntity>
            )
          })}
          {pages > 1 && (
            <UiEntity uiTransform={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', height: px(34), margin: { top: px(8) } }}>
              <Label value={`${adminPage + 1} / ${pages}`} fontSize={px(14)} color={DIM} uiTransform={{ margin: { right: px(4) } }} />
              {button('up', '▲', adminPage > 0, () => { adminPage = Math.max(0, adminPage - 1) })}
              {button('down', '▼', adminPage < pages - 1, () => { adminPage = Math.min(pages - 1, adminPage + 1) })}
            </UiEntity>
          )}
        </UiEntity>
      )}
    </UiEntity>
  )
}

/** While standing on a lift: its floor panel. Click a floor, or press its number key. */
function LiftLegend() {
  const lift = liftPanel()
  if (!lift) return null
  const status = lift.moving ? (lift.dir > 0 ? '▲  GOING UP' : '▼  GOING DOWN') : 'PICK A FLOOR  ·  KEYS 1-4'
  return (
    <UiEntity uiTransform={{ positionType: 'absolute', position: { right: px(24), top: '30%' }, width: px(380), flexDirection: 'column', padding: px(12) }} uiBackground={{ color: PANEL }}>
      <Label value="LIFT" fontSize={px(16)} color={DIM} textAlign="middle-left" uiTransform={{ height: px(22) }} />
      <Label value={status} fontSize={px(15)} color={CYAN} textAlign="middle-left" uiTransform={{ height: px(22), margin: { bottom: px(6) } }} />
      {[...lift.floors].reverse().map((f) => (
        <UiEntity
          key={f.key}
          uiTransform={{ height: px(38), margin: { top: px(4) }, padding: { left: px(8), right: px(8) }, alignItems: 'center', flexDirection: 'row' }}
          uiBackground={{ color: f.here ? CYAN : f.picked ? AMBER : Color4.create(1, 1, 1, 0.08) }}
          onMouseDown={f.press}
        >
          <Label value={f.number} fontSize={px(20)} color={f.here || f.picked ? Color4.Black() : CYAN} uiTransform={{ width: px(28) }} />
          <Label value={f.name} fontSize={px(15)} color={f.here || f.picked ? Color4.Black() : DIM} textAlign="middle-left" uiTransform={{ flexGrow: 1 }} />
        </UiEntity>
      ))}
    </UiEntity>
  )
}

/** The ship scene's music bar (galaxy-gardeners-dcl src/ui.tsx), copied unchanged: the track playing, NEXT, MUTE. */
const MusicBar = () => {
  const track = currentTrack()
  if (!track) return null   // nothing to show until the playlist has loaded
  const muted = isMuted()
  const title = track.artist ? `${track.title} — ${track.artist}` : track.title
  return (
    <UiEntity uiTransform={{ positionType: 'absolute', position: { bottom: px(20), right: px(30) }, flexDirection: 'row', alignItems: 'center', padding: px(4) }}
      uiBackground={{ color: Color4.create(0.02, 0.05, 0.12, 0.85) }}>
      <Label value={muted ? '♪ MUTED' : `♪ ${title}`} fontSize={px(12)} color={Color4.create(0.45, 0.65, 0.75, 1)} uiTransform={{ margin: { left: px(8), right: px(8) } }} />
      <UiEntity uiTransform={{ width: px(60), height: px(26), margin: { right: px(4) }, justifyContent: 'center', alignItems: 'center' }}
        uiBackground={{ color: Color4.create(0.05, 0.12, 0.2, 1) }}
        onMouseDown={() => { nextTrack() }}>
        <Label value="NEXT" fontSize={px(12)} color={Color4.create(0, 0.9, 1, 1)} />
      </UiEntity>
      <UiEntity uiTransform={{ width: px(76), height: px(26), justifyContent: 'center', alignItems: 'center' }}
        uiBackground={{ color: muted ? Color4.create(0.05, 0.12, 0.2, 1) : Color4.create(0, 0.9, 1, 1) }}
        onMouseDown={() => { toggleMuted() }}>
        <Label value={muted ? 'UNMUTE' : 'MUTE'} fontSize={px(12)} color={muted ? Color4.create(0, 0.9, 1, 1) : Color4.create(0.02, 0.05, 0.1, 1)} />
      </UiEntity>
    </UiEntity>
  )
}

/** In the club: the same bar, showing what Relay Radio is playing instead (the soundtrack's faded out up there). */
const RadioBar = () => {
  const d = radioDisplay()
  const genre = radioGenre()
  const muted = isRadioMuted()
  const body = d.body.replace('\n', ' — ')
  return (
    <UiEntity uiTransform={{ positionType: 'absolute', position: { bottom: px(20), right: px(30) }, flexDirection: 'row', alignItems: 'center', padding: px(4) }}
      uiBackground={{ color: Color4.create(0.02, 0.05, 0.12, 0.85) }}>
      <UiEntity uiTransform={{ height: px(26), padding: { left: px(8), right: px(8) }, justifyContent: 'center', alignItems: 'center' }}
        uiBackground={{ color: Color4.create(1, 0.22, 0.7, 1) }}>
        <Label value="RELAY RADIO" fontSize={px(12)} color={Color4.create(0.02, 0.05, 0.1, 1)} />
      </UiEntity>
      <Label value={muted ? '♪ MUTED' : d.head === 'NOW PLAYING' ? `♪ ${body}${genre ? `  ·  ${genre}` : ''}` : `♪ ${body}`} fontSize={px(12)}
        color={Color4.create(0.45, 0.65, 0.75, 1)} uiTransform={{ margin: { left: px(8), right: px(8) } }} />
      <UiEntity uiTransform={{ width: px(76), height: px(26), justifyContent: 'center', alignItems: 'center' }}
        uiBackground={{ color: muted ? Color4.create(0.05, 0.12, 0.2, 1) : Color4.create(0, 0.9, 1, 1) }}
        onMouseDown={() => { toggleRadioMuted() }}>
        <Label value={muted ? 'UNMUTE' : 'MUTE'} fontSize={px(12)} color={muted ? Color4.create(0, 0.9, 1, 1) : Color4.create(0.02, 0.05, 0.1, 1)} />
      </UiEntity>
    </UiEntity>
  )
}

/** The music bar: the soundtrack's (the ship's own bar) on the station, Relay Radio's in the club. */
const StationMusicBar = () => (inTheClub() ? <RadioBar /> : <MusicBar />)

/** At an airlock: the way home. */
function AirlockPrompt() {
  if (!standingAtAirlock() || getGateState().kind !== 'aboard') return null
  return (
    <UiEntity uiTransform={{ positionType: 'absolute', position: { bottom: px(140) }, width: '100%', justifyContent: 'center' }}>
      <UiEntity uiTransform={{ padding: { top: px(12), bottom: px(12), left: px(22), right: px(22) }, flexDirection: 'row', alignItems: 'center' }} uiBackground={{ color: PANEL }}>
        <UiEntity uiTransform={{ width: px(40), height: px(40), justifyContent: 'center', alignItems: 'center', margin: { right: px(14) } }} uiBackground={{ color: CYAN }}>
          <Label value="E" fontSize={px(24)} color={Color4.Black()} />
        </UiEntity>
        <Label value="Return to your ship" fontSize={px(24)} color={CYAN} />
      </UiEntity>
    </UiEntity>
  )
}

export function setupUi(): void {
  ReactEcsRenderer.setUiRenderer(() => (
    <UiEntity uiTransform={{ width: '100%', height: '100%' }}>
      <StatusBanner />
      <AdminPanel />
      <LiftLegend />
      <AirlockPrompt />
      <ShipDialogs />
      <ComposePanel />
      <InvadersScreen />
      <GardenScreen />
      <BreakerScreen />
      <CometScreen />
      <DriftScreen />
      <OrbitScreen />
      <RacerScreen />
      <FuelPanel />
      <StationMusicBar />
    </UiEntity>
  ))
}
