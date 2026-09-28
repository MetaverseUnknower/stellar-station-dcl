// The black market terminal's panel: a grubby green-screen, the goods down the left, the deal on the right.
// State and actions are in market.ts. Sizes are authored at 1080 px tall and scaled with px() (uiScale.ts).
import ReactEcs, { UiEntity, Label, Input } from '@dcl/sdk/react-ecs'
import { Color4 } from '@dcl/sdk/math'
import { px } from '../uiScale'
import {
  market, closeMarket, selectItem, askQuote, pay, again, starMatches, pickStar, toggleGuest, paramsChanged, needsStar,
  MAX_GUESTS
} from './market'
import type { MarketItem } from '../stationApi'

const BG = Color4.create(0.01, 0.025, 0.015, 0.95)
const GREEN = Color4.create(0.3, 1, 0.45, 1)
const DIM = Color4.create(0.2, 0.55, 0.3, 1)
const FAINT = Color4.create(0.08, 0.22, 0.12, 1)
const PINK = Color4.create(1, 0.2, 0.65, 1)
const WARN = Color4.create(1, 0.45, 0.3, 1)
const BLACK = Color4.create(0, 0.02, 0.01, 1)
const FIELD = Color4.create(0.02, 0.07, 0.04, 1)

const W = 940
const H = 620
const LIST_W = 330
const MONO = 'monospace' as const

function Button(props: { label: string; onClick: () => void; enabled?: boolean; accent?: Color4; width?: number }) {
  const on = props.enabled !== false
  const colour = props.accent ?? GREEN
  return (
    <UiEntity
      uiTransform={{ height: px(40), width: props.width ? px(props.width) : 'auto', padding: { left: px(16), right: px(16) }, margin: { right: px(10) }, justifyContent: 'center', alignItems: 'center', borderWidth: px(2), borderColor: on ? colour : FAINT, borderRadius: px(4) }}
      uiBackground={{ color: on ? colour : BLACK }}
      onMouseDown={() => on && props.onClick()}
    >
      <Label value={props.label} fontSize={px(17)} font={MONO} color={on ? BLACK : DIM} />
    </UiEntity>
  )
}

function ItemRow(props: { key?: string; item: MarketItem }) {
  const { item } = props
  const picked = market.selected?.id === item.id
  return (
    <UiEntity
      uiTransform={{ width: '100%', height: px(38), flexDirection: 'row', alignItems: 'center', padding: { left: px(10), right: px(10) }, margin: { bottom: px(3) } }}
      uiBackground={{ color: picked ? GREEN : Color4.create(0, 0, 0, 0) }}
      onMouseDown={() => selectItem(item)}
    >
      <Label value={item.name} fontSize={px(15)} font={MONO} color={picked ? BLACK : GREEN} textAlign="middle-left" uiTransform={{ flexGrow: 1 }} />
      <Label value={`${item.mana}`} fontSize={px(15)} font={MONO} color={picked ? BLACK : PINK} textAlign="middle-right" />
    </UiEntity>
  )
}

function StarPicker() {
  if (market.star) {
    return (
      <UiEntity uiTransform={{ flexDirection: 'row', alignItems: 'center', height: px(40), margin: { bottom: px(8) } }}>
        <Label value={`TARGET: ${market.star.name}`} fontSize={px(17)} font={MONO} color={GREEN} textAlign="middle-left" uiTransform={{ margin: { right: px(14) } }} />
        <Button label="CHANGE" enabled={!market.busy} onClick={() => { market.star = null; paramsChanged() }} />
      </UiEntity>
    )
  }
  const matches = starMatches()
  return (
    <UiEntity uiTransform={{ flexDirection: 'column', margin: { bottom: px(8) } }}>
      <Input
        placeholder="Type a star's name…"
        placeholderColor={DIM}
        value={market.starQuery}
        onChange={(v) => { market.starQuery = v }}
        fontSize={px(16)}
        color={GREEN}
        textAlign="middle-left"
        uiTransform={{ width: '100%', height: px(40), padding: { left: px(10) }, borderWidth: px(2), borderColor: DIM, borderRadius: px(4) }}
        uiBackground={{ color: FIELD }}
      />
      <UiEntity uiTransform={{ flexDirection: 'row', flexWrap: 'wrap', margin: { top: px(6) } }}>
        {matches.map((s) => (
          <UiEntity
            key={s.id}
            uiTransform={{ height: px(30), padding: { left: px(10), right: px(10) }, margin: { right: px(6), bottom: px(6) }, justifyContent: 'center', borderWidth: px(1), borderColor: GREEN, borderRadius: px(4) }}
            onMouseDown={() => pickStar(s)}
          >
            <Label value={s.name} fontSize={px(14)} font={MONO} color={GREEN} />
          </UiEntity>
        ))}
        {market.starQuery.trim() && matches.length === 0 && <Label value="Never heard of it." fontSize={px(14)} font={MONO} color={DIM} />}
      </UiEntity>
    </UiEntity>
  )
}

function TextField(props: { placeholder: string; value: string; max: number; onChange: (v: string) => void }) {
  return (
    <UiEntity uiTransform={{ flexDirection: 'column', margin: { bottom: px(8) } }}>
      <Input
        placeholder={props.placeholder}
        placeholderColor={DIM}
        value={props.value}
        onChange={(v) => { props.onChange(v.slice(0, props.max)); paramsChanged() }}
        fontSize={px(16)}
        color={GREEN}
        textAlign="middle-left"
        uiTransform={{ width: '100%', height: px(40), padding: { left: px(10) }, borderWidth: px(2), borderColor: DIM, borderRadius: px(4) }}
        uiBackground={{ color: FIELD }}
      />
      <Label value={`${props.value.length}/${props.max}`} fontSize={px(12)} font={MONO} color={DIM} textAlign="middle-right" uiTransform={{ width: '100%', height: px(18) }} />
    </UiEntity>
  )
}

function Guests() {
  if (!market.friends.length) {
    return <Label value="No friends to invite. Just you, then." fontSize={px(14)} font={MONO} color={DIM} textAlign="middle-left" uiTransform={{ height: px(26) }} />
  }
  return (
    <UiEntity uiTransform={{ flexDirection: 'column', margin: { bottom: px(6) } }}>
      <Label value={`GUEST LIST (${market.guests.length}/${MAX_GUESTS})`} fontSize={px(13)} font={MONO} color={DIM} textAlign="middle-left" uiTransform={{ height: px(22) }} />
      <UiEntity uiTransform={{ flexDirection: 'row', flexWrap: 'wrap', maxHeight: px(110), overflow: 'hidden' }}>
        {market.friends.map((f) => {
          const on = market.guests.includes(f.playerId)
          return (
            <UiEntity
              key={f.playerId}
              uiTransform={{ height: px(28), padding: { left: px(8), right: px(8) }, margin: { right: px(6), bottom: px(6) }, justifyContent: 'center', borderWidth: px(1), borderColor: on ? PINK : DIM, borderRadius: px(4) }}
              uiBackground={{ color: on ? PINK : BLACK }}
              onMouseDown={() => !market.busy && toggleGuest(f.playerId)}
            >
              <Label value={f.username} fontSize={px(13)} font={MONO} color={on ? BLACK : GREEN} />
            </UiEntity>
          )
        })}
      </UiEntity>
    </UiEntity>
  )
}

function Params(props: { item: MarketItem }) {
  const { item } = props
  if (market.phase === 'done' || market.phase === 'confirming') return null
  return (
    <UiEntity uiTransform={{ flexDirection: 'column', width: '100%' }}>
      {needsStar(item) && <StarPicker />}
      {item.kind === 'wormhole' && item.exclusive && <Guests />}
      {item.kind === 'rename' && <TextField placeholder="The new name" value={market.name} max={30} onChange={(v) => { market.name = v }} />}
      {item.kind === 'radio' && <TextField placeholder="Your message to the galaxy" value={market.radio} max={80} onChange={(v) => { market.radio = v }} />}
    </UiEntity>
  )
}

function Actions(props: { item: MarketItem }) {
  const { item } = props
  const phase = market.phase
  return (
    <UiEntity uiTransform={{ flexDirection: 'row', alignItems: 'center', margin: { top: px(6) } }}>
      {phase === 'browse' && <Button label="ASK THE DEALER" enabled={!market.busy} onClick={() => void askQuote()} />}
      {phase === 'quoted' && <Button label={`PAY ${item.mana} MANA`} accent={PINK} enabled={!market.busy} onClick={() => void pay()} />}
      {phase === 'quoted' && <Button label="NEVER MIND" enabled={!market.busy} onClick={again} />}
      {phase === 'done' && <Button label="ANOTHER DEAL" enabled={!market.busy} onClick={again} />}
    </UiEntity>
  )
}

function Deal() {
  const item = market.selected
  if (!item) {
    return (
      <UiEntity uiTransform={{ flexDirection: 'column', width: '100%' }}>
        <Label value="> WHAT'LL IT BE, CAPTAIN?_" fontSize={px(20)} font={MONO} color={GREEN} textAlign="top-left" uiTransform={{ height: px(34) }} />
        <Label value="Everything's paid in MANA on Polygon. The dealer checks the job can be done before you pay." fontSize={px(15)} font={MONO} color={DIM} textAlign="top-left" textWrap="wrap" uiTransform={{ width: '100%', height: px(60) }} />
      </UiEntity>
    )
  }
  return (
    <UiEntity uiTransform={{ flexDirection: 'column', width: '100%' }}>
      <UiEntity uiTransform={{ flexDirection: 'row', height: px(34), alignItems: 'center' }}>
        <Label value={`> ${item.name.toUpperCase()}`} fontSize={px(20)} font={MONO} color={GREEN} textAlign="middle-left" uiTransform={{ flexGrow: 1 }} />
        <Label value={`${item.mana} MANA`} fontSize={px(20)} font={MONO} color={PINK} textAlign="middle-right" />
      </UiEntity>
      <Label value={item.blurb} fontSize={px(15)} font={MONO} color={DIM} textAlign="top-left" textWrap="wrap" uiTransform={{ width: '100%', height: px(62), margin: { bottom: px(8) } }} />
      <Params item={item} />
      {market.summary !== '' && (
        <UiEntity uiTransform={{ width: '100%', padding: px(10), margin: { top: px(4), bottom: px(4) }, borderWidth: px(1), borderColor: PINK, borderRadius: px(4) }}>
          <Label value={market.summary} fontSize={px(16)} font={MONO} color={GREEN} textAlign="middle-left" textWrap="wrap" uiTransform={{ width: '100%' }} />
        </UiEntity>
      )}
      <Actions item={item} />
    </UiEntity>
  )
}

export function MarketPanel() {
  if (!market.open) return null
  return (
    <UiEntity uiTransform={{ positionType: 'absolute', width: '100%', height: '100%', justifyContent: 'center', alignItems: 'center' }}>
      <UiEntity
        uiTransform={{ width: px(W), height: px(H), flexDirection: 'column', padding: px(18), borderWidth: px(2), borderColor: DIM, borderRadius: px(6) }}
        uiBackground={{ color: BG }}
      >
        {/* Header */}
        <UiEntity uiTransform={{ flexDirection: 'row', alignItems: 'center', height: px(44), margin: { bottom: px(10) } }}>
          <Label value="BLACK MARKET" fontSize={px(28)} font={MONO} color={PINK} textAlign="middle-left" />
          <Label value="no refunds · no questions" fontSize={px(14)} font={MONO} color={DIM} textAlign="middle-left" uiTransform={{ flexGrow: 1, margin: { left: px(16) } }} />
          <UiEntity uiTransform={{ width: px(40), height: px(40), justifyContent: 'center', alignItems: 'center', borderWidth: px(2), borderColor: DIM, borderRadius: px(4) }} onMouseDown={closeMarket}>
            <Label value="X" fontSize={px(18)} font={MONO} color={GREEN} />
          </UiEntity>
        </UiEntity>
        {market.loading ? (
          <Label value="Dialling in…" fontSize={px(18)} font={MONO} color={GREEN} textAlign="middle-left" uiTransform={{ height: px(40) }} />
        ) : (
          <UiEntity uiTransform={{ flexDirection: 'row', flexGrow: 1 }}>
            <UiEntity uiTransform={{ width: px(LIST_W), flexDirection: 'column', margin: { right: px(22) } }}>
              {market.items.map((item) => <ItemRow key={item.id} item={item} />)}
            </UiEntity>
            <UiEntity uiTransform={{ flexGrow: 1, flexDirection: 'column' }}>
              <Deal />
            </UiEntity>
          </UiEntity>
        )}
        {/* Status and footer */}
        <Label value={market.message} fontSize={px(15)} font={MONO} color={market.warn ? WARN : GREEN} textAlign="middle-left" textWrap="wrap" uiTransform={{ width: '100%', height: px(44) }} />
        <Label value={market.mine} fontSize={px(13)} font={MONO} color={DIM} textAlign="middle-left" uiTransform={{ width: '100%', height: px(20) }} />
      </UiEntity>
    </UiEntity>
  )
}
