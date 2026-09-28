// The CREW button (bottom right, over the music bar; the client's chat has the bottom left), with any friend
// requests waiting, and the Crew panel over it: my friend code, add by code, requests to answer, who's docked here,
// and my friends. State and actions are in crew.ts. Sizes are authored at 1080 px tall and scaled with px()
// (uiScale.ts), in the station HUD's colours (ui.tsx).
import ReactEcs, { UiEntity, Label, Input } from '@dcl/sdk/react-ecs'
import { Color4 } from '@dcl/sdk/math'
import { px } from '../uiScale'
import { getGateState } from '../gate'
import { crew, toggleCrew, addByCode, addDocked, accept, decline, relationTo, dockedHere } from './crew'

const PANEL = Color4.create(0.02, 0.06, 0.12, 0.92)
const CYAN = Color4.create(0, 0.9, 1, 1)
const DIM = Color4.create(0.6, 0.7, 0.8, 1)
const FAINT = Color4.create(0.3, 0.38, 0.48, 1)
const AMBER = Color4.create(1, 0.75, 0.2, 1)
const WARN = Color4.create(1, 0.55, 0.4, 1)
const DARK = Color4.create(0.02, 0.05, 0.1, 1)
const FIELD = Color4.create(0.05, 0.12, 0.2, 1)
const SHOW = 6 // rows per list before "+N more"

function SmallButton(props: { label: string; onClick: () => void; filled?: boolean }) {
  const on = !crew.busy
  return (
    <UiEntity
      uiTransform={{ height: px(26), padding: { left: px(10), right: px(10) }, margin: { left: px(6) }, justifyContent: 'center', alignItems: 'center', borderWidth: px(1), borderColor: on ? CYAN : FAINT }}
      uiBackground={{ color: props.filled && on ? CYAN : DARK }}
      onMouseDown={() => on && props.onClick()}
    >
      <Label value={props.label} fontSize={px(12)} color={props.filled && on ? DARK : on ? CYAN : FAINT} />
    </UiEntity>
  )
}

function Heading(props: { text: string }) {
  return <Label value={props.text} fontSize={px(13)} color={FAINT} textAlign="middle-left" uiTransform={{ height: px(22), margin: { top: px(10) } }} />
}

function Row(props: { key?: string; name: string; children?: any }) {
  return (
    <UiEntity uiTransform={{ flexDirection: 'row', alignItems: 'center', height: px(30), width: '100%' }}>
      <Label value={props.name} fontSize={px(15)} color={DIM} textAlign="middle-left" uiTransform={{ flexGrow: 1 }} />
      {props.children}
    </UiEntity>
  )
}

const More = (props: { n: number }) =>
  props.n > 0 ? <Label value={`+${props.n} more`} fontSize={px(12)} color={FAINT} textAlign="middle-left" uiTransform={{ height: px(20) }} /> : null

export function CrewPanel() {
  if (!crew.open || getGateState().kind !== 'aboard') return null
  const docked = dockedHere()
  return (
    <UiEntity
      uiTransform={{ positionType: 'absolute', position: { right: px(30), bottom: px(108) }, width: px(430), flexDirection: 'column', padding: px(16) }}
      uiBackground={{ color: PANEL }}
    >
      <UiEntity uiTransform={{ flexDirection: 'row', alignItems: 'center', height: px(30) }}>
        <Label value="CREW" fontSize={px(20)} color={CYAN} textAlign="middle-left" uiTransform={{ flexGrow: 1 }} />
        <Label value={crew.myCode ? `MY CODE  ${crew.myCode}` : ''} fontSize={px(15)} color={AMBER} textAlign="middle-right" />
      </UiEntity>

      <UiEntity uiTransform={{ flexDirection: 'row', alignItems: 'center', margin: { top: px(10) } }}>
        <Input
          placeholder="A friend's code"
          placeholderColor={FAINT}
          value={crew.code}
          onChange={(v) => { crew.code = v }}
          onSubmit={addByCode}
          fontSize={px(15)}
          color={CYAN}
          textAlign="middle-left"
          uiTransform={{ flexGrow: 1, height: px(32), padding: { left: px(8) } }}
          uiBackground={{ color: FIELD }}
        />
        <SmallButton label="ADD" filled onClick={addByCode} />
      </UiEntity>

      {crew.incoming.length > 0 && <Heading text={`REQUESTS (${crew.incoming.length})`} />}
      {crew.incoming.slice(0, SHOW).map((r) => (
        <Row key={r.friendshipId} name={r.fromUsername}>
          <SmallButton label="ACCEPT" filled onClick={() => accept(r)} />
          <SmallButton label="DECLINE" onClick={() => decline(r)} />
        </Row>
      ))}
      <More n={crew.incoming.length - SHOW} />

      <Heading text={`DOCKED HERE (${docked.length})`} />
      {docked.length === 0 && <Label value="Nobody else is docked here right now." fontSize={px(13)} color={FAINT} textAlign="middle-left" uiTransform={{ height: px(24) }} />}
      {docked.slice(0, SHOW).map((p) => {
        const rel = relationTo(p.playerId)
        const incoming = crew.incoming.find((r) => r.fromPlayerId === p.playerId)
        return (
          <Row key={p.playerId} name={p.username}>
            {rel === 'friend' && <Label value="FRIEND" fontSize={px(12)} color={FAINT} />}
            {rel === 'asked' && <Label value="REQUESTED" fontSize={px(12)} color={FAINT} />}
            {rel === 'asks' && incoming && <SmallButton label="ACCEPT" filled onClick={() => accept(incoming)} />}
            {rel === 'none' && <SmallButton label="ADD FRIEND" onClick={() => addDocked(p.playerId)} />}
          </Row>
        )
      })}
      <More n={docked.length - SHOW} />

      <Heading text={`FRIENDS (${crew.friends.length})`} />
      {crew.friends.length === 0 && <Label value="None yet. Friends can join your private wormholes." fontSize={px(13)} color={FAINT} textAlign="middle-left" uiTransform={{ height: px(24) }} />}
      {crew.friends.slice(0, SHOW).map((f) => <Row key={f.playerId} name={f.username} />)}
      <More n={crew.friends.length - SHOW} />

      {crew.message !== '' && (
        <Label value={crew.message} fontSize={px(13)} color={crew.warn ? WARN : CYAN} textAlign="middle-left" textWrap="wrap" uiTransform={{ width: '100%', height: px(36), margin: { top: px(8) } }} />
      )}
    </UiEntity>
  )
}

/** The CREW button, with a count of requests waiting. */
export function CrewButton() {
  if (getGateState().kind !== 'aboard') return null
  const waiting = crew.incoming.length
  return (
    <UiEntity
      uiTransform={{ positionType: 'absolute', position: { right: px(30), bottom: px(64) }, height: px(34), padding: { left: px(14), right: px(14) }, justifyContent: 'center', alignItems: 'center', flexDirection: 'row' }}
      uiBackground={{ color: crew.open ? CYAN : PANEL }}
      onMouseDown={toggleCrew}
    >
      <Label value="CREW" fontSize={px(14)} color={crew.open ? DARK : CYAN} />
      {waiting > 0 && (
        <UiEntity uiTransform={{ height: px(22), padding: { left: px(8), right: px(8) }, margin: { left: px(8) }, justifyContent: 'center' }} uiBackground={{ color: AMBER }}>
          <Label value={`${waiting} REQUEST${waiting === 1 ? '' : 'S'}`} fontSize={px(11)} color={DARK} />
        </UiEntity>
      )}
    </UiEntity>
  )
}
