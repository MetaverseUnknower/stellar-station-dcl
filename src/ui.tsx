// Station HUD: gate status while signing in or being sent back, the crew docked here, and the way home.
// Sizes are authored at 1080 px tall and scaled with px() (see uiScale.ts).
import ReactEcs, { ReactEcsRenderer, UiEntity, Label } from '@dcl/sdk/react-ecs'
import { Color4 } from '@dcl/sdk/math'
import { px } from './uiScale'
import { getGateState, returnToShip, isAdmin, getStations, pickStation } from './gate'
import { getCrew } from './audience'

const PANEL = Color4.create(0.02, 0.06, 0.12, 0.85)
const CYAN = Color4.create(0, 0.9, 1, 1)
const DIM = Color4.create(0.6, 0.7, 0.8, 1)
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

function CrewPanel() {
  if (getGateState().kind !== 'aboard') return null
  const crew = getCrew()
  return (
    <UiEntity
      uiTransform={{
        positionType: 'absolute',
        position: { right: px(24), top: px(200) },
        width: px(300),
        padding: px(16),
        flexDirection: 'column'
      }}
      uiBackground={{ color: PANEL }}
    >
      <Label value="DOCKED CREWS" fontSize={px(20)} color={CYAN} uiTransform={{ height: px(30) }} textAlign="middle-left" />
      {crew.map((p) => (
        <Label
          key={p.playerId}
          value={p.walletAddress ? p.username : `${p.username} (mobile)`}
          fontSize={px(18)}
          color={DIM}
          uiTransform={{ height: px(26) }}
          textAlign="middle-left"
        />
      ))}
      <UiEntity
        uiTransform={{ margin: { top: px(12) }, padding: px(10), justifyContent: 'center' }}
        uiBackground={{ color: CYAN }}
        onMouseDown={() => returnToShip('Heading back to your ship.')}
      >
        <Label value="RETURN TO SHIP" fontSize={px(18)} color={Color4.Black()} />
      </UiEntity>
    </UiEntity>
  )
}

/** Admin-only debug panel: every station; picking one switches whose players you see. */
function AdminPanel() {
  const gate = getGateState()
  if (!isAdmin() || gate.kind !== 'aboard') return null
  return (
    <UiEntity
      uiTransform={{
        positionType: 'absolute',
        position: { left: px(24), top: px(200) },
        width: px(300),
        padding: px(16),
        flexDirection: 'column'
      }}
      uiBackground={{ color: PANEL }}
    >
      <Label value="ADMIN  ·  STATIONS" fontSize={px(20)} color={WARN} uiTransform={{ height: px(30) }} textAlign="middle-left" />
      {getStations().map((s) => {
        const current = s.id === gate.stationId
        return (
          <UiEntity
            key={s.id}
            uiTransform={{ height: px(34), margin: { top: px(4) }, padding: { left: px(10) }, alignItems: 'center' }}
            uiBackground={{ color: current ? CYAN : Color4.create(1, 1, 1, 0.08) }}
            onMouseDown={() => pickStation(s.id)}
          >
            <Label value={s.name} fontSize={px(17)} color={current ? Color4.Black() : DIM} textAlign="middle-left" />
          </UiEntity>
        )
      })}
    </UiEntity>
  )
}

export function setupUi(): void {
  ReactEcsRenderer.setUiRenderer(() => (
    <UiEntity uiTransform={{ width: '100%', height: '100%' }}>
      <StatusBanner />
      <CrewPanel />
      <AdminPanel />
    </UiEntity>
  ))
}
