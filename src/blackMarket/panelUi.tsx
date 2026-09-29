// The relay's panel: a transmission to the Eld. Their offers down the left, the petition on the right; their words
// decode in character by character, as if arriving from very far away. State and actions are in market.ts. Sizes
// are authored at 1080 px tall and scaled with px() (uiScale.ts).
import ReactEcs, { UiEntity, Label, Input } from '@dcl/sdk/react-ecs'
import { Color4 } from '@dcl/sdk/math'
import { px } from '../uiScale'
import {
  market, closeMarket, selectItem, askQuote, pay, again, starMatches, pickStar, toggleGuest, paramsChanged, needsStar,
  MAX_GUESTS
} from './market'
import type { MarketItem } from '../stationApi'

const BG = Color4.create(0.012, 0.008, 0.035, 0.96)
const EDGE = Color4.create(0.4, 0.26, 0.75, 1)
const LAVENDER = Color4.create(0.86, 0.8, 1, 1)
const VIOLET = Color4.create(0.66, 0.46, 1, 1)
const CYAN = Color4.create(0.45, 0.9, 1, 1)
const DIM = Color4.create(0.5, 0.45, 0.7, 1)
const FAINT = Color4.create(0.18, 0.13, 0.32, 1)
const WARN = Color4.create(1, 0.5, 0.55, 1)
const INK = Color4.create(0.02, 0.01, 0.05, 1)
const FIELD = Color4.create(0.04, 0.025, 0.09, 1)
const CLEAR = Color4.create(0, 0, 0, 0)

const W = 960
const H = 640
const LIST_W = 320
const MONO = 'monospace' as const

// ── Decoding: text arrives a few characters at a time, the next few still scrambled ──
const GLYPHS = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789#%&*+=/<>'
const MS_PER_CHAR = 14
const SCRAMBLE_AHEAD = 5
const decoding = new Map<string, { text: string; since: number }>()

function decoded(key: string, text: string): string {
  const now = Date.now()
  let d = decoding.get(key)
  if (!d || d.text !== text) {
    d = { text, since: now }
    decoding.set(key, d)
  }
  const shown = Math.floor((now - d.since) / MS_PER_CHAR)
  if (shown >= text.length) return text
  let tail = ''
  for (let i = shown; i < Math.min(text.length, shown + SCRAMBLE_AHEAD); i++) {
    tail += text[i] === ' ' ? ' ' : GLYPHS[Math.floor(Math.random() * GLYPHS.length)]
  }
  return text.slice(0, shown) + tail
}

function Button(props: { label: string; onClick: () => void; enabled?: boolean; primary?: boolean }) {
  const on = props.enabled !== false
  const fill = props.primary ? VIOLET : CLEAR
  return (
    <UiEntity
      uiTransform={{
        height: px(42), padding: { left: px(18), right: px(18) }, margin: { right: px(10) }, justifyContent: 'center', alignItems: 'center',
        borderWidth: px(1), borderColor: on ? (props.primary ? VIOLET : EDGE) : FAINT, borderRadius: px(21)
      }}
      uiBackground={{ color: on ? fill : CLEAR }}
      onMouseDown={() => on && props.onClick()}
    >
      <Label value={props.label} fontSize={px(15)} font={MONO} color={!on ? FAINT : props.primary ? INK : LAVENDER} />
    </UiEntity>
  )
}

function ItemRow(props: { key?: string; item: MarketItem }) {
  const { item } = props
  const picked = market.selected?.id === item.id
  return (
    <UiEntity
      uiTransform={{ width: '100%', height: px(40), flexDirection: 'row', alignItems: 'center', margin: { bottom: px(2) } }}
      uiBackground={{ color: picked ? Color4.create(0.4, 0.26, 0.75, 0.25) : CLEAR }}
      onMouseDown={() => selectItem(item)}
    >
      <UiEntity uiTransform={{ width: px(3), height: '70%', margin: { right: px(10) } }} uiBackground={{ color: picked ? CYAN : CLEAR }} />
      <Label value={item.name} fontSize={px(15)} font={MONO} color={picked ? LAVENDER : DIM} textAlign="middle-left" uiTransform={{ flexGrow: 1 }} />
      <Label value={`${item.mana}`} fontSize={px(15)} font={MONO} color={picked ? CYAN : FAINT} textAlign="middle-right" uiTransform={{ margin: { right: px(8) } }} />
    </UiEntity>
  )
}

const inputTransform = { width: '100%' as const, height: px(42), padding: { left: px(12) }, borderWidth: px(1), borderColor: EDGE, borderRadius: px(6) }

function StarPicker() {
  if (market.star) {
    return (
      <UiEntity uiTransform={{ flexDirection: 'row', alignItems: 'center', height: px(44), margin: { bottom: px(8) } }}>
        <Label value={`STAR  ${market.star.name}`} fontSize={px(17)} font={MONO} color={LAVENDER} textAlign="middle-left" uiTransform={{ margin: { right: px(14) } }} />
        <Button label="CHANGE" enabled={!market.busy} onClick={() => { market.star = null; paramsChanged() }} />
      </UiEntity>
    )
  }
  const matches = starMatches()
  return (
    <UiEntity uiTransform={{ flexDirection: 'column', margin: { bottom: px(8) } }}>
      <Input
        placeholder="Name a star…"
        placeholderColor={FAINT}
        value={market.starQuery}
        onChange={(v) => { market.starQuery = v }}
        fontSize={px(16)}
        color={LAVENDER}
        textAlign="middle-left"
        uiTransform={inputTransform}
        uiBackground={{ color: FIELD }}
      />
      <UiEntity uiTransform={{ flexDirection: 'row', flexWrap: 'wrap', margin: { top: px(6) } }}>
        {matches.map((s) => (
          <UiEntity
            key={s.id}
            uiTransform={{ height: px(30), padding: { left: px(12), right: px(12) }, margin: { right: px(6), bottom: px(6) }, justifyContent: 'center', borderWidth: px(1), borderColor: CYAN, borderRadius: px(15) }}
            onMouseDown={() => pickStar(s)}
          >
            <Label value={s.name} fontSize={px(14)} font={MONO} color={CYAN} />
          </UiEntity>
        ))}
        {market.starQuery.trim() && matches.length === 0 && <Label value="No such star in your galaxy." fontSize={px(14)} font={MONO} color={DIM} />}
      </UiEntity>
    </UiEntity>
  )
}

function TextField(props: { placeholder: string; value: string; max: number; onChange: (v: string) => void }) {
  return (
    <UiEntity uiTransform={{ flexDirection: 'column', margin: { bottom: px(8) } }}>
      <Input
        placeholder={props.placeholder}
        placeholderColor={FAINT}
        value={props.value}
        onChange={(v) => { props.onChange(v.slice(0, props.max)); paramsChanged() }}
        fontSize={px(16)}
        color={LAVENDER}
        textAlign="middle-left"
        uiTransform={inputTransform}
        uiBackground={{ color: FIELD }}
      />
      <Label value={`${props.value.length}/${props.max}`} fontSize={px(12)} font={MONO} color={FAINT} textAlign="middle-right" uiTransform={{ width: '100%', height: px(18) }} />
    </UiEntity>
  )
}

function Guests() {
  if (!market.friends.length) {
    return <Label value="You have no friends to bring. It will be yours alone." fontSize={px(14)} font={MONO} color={DIM} textAlign="middle-left" uiTransform={{ height: px(26) }} />
  }
  return (
    <UiEntity uiTransform={{ flexDirection: 'column', margin: { bottom: px(6) } }}>
      <Label value={`WHO MAY PASS  ${market.guests.length}/${MAX_GUESTS}`} fontSize={px(13)} font={MONO} color={DIM} textAlign="middle-left" uiTransform={{ height: px(22) }} />
      <UiEntity uiTransform={{ flexDirection: 'row', flexWrap: 'wrap', maxHeight: px(110), overflow: 'hidden' }}>
        {market.friends.map((f) => {
          const on = market.guests.includes(f.playerId)
          return (
            <UiEntity
              key={f.playerId}
              uiTransform={{ height: px(28), padding: { left: px(10), right: px(10) }, margin: { right: px(6), bottom: px(6) }, justifyContent: 'center', borderWidth: px(1), borderColor: on ? CYAN : FAINT, borderRadius: px(14) }}
              uiBackground={{ color: on ? CYAN : CLEAR }}
              onMouseDown={() => !market.busy && toggleGuest(f.playerId)}
            >
              <Label value={f.username} fontSize={px(13)} font={MONO} color={on ? INK : DIM} />
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
      {item.kind === 'rename' && <TextField placeholder="The star's new name" value={market.name} max={30} onChange={(v) => { market.name = v }} />}
      {item.kind === 'radio' && <TextField placeholder="Your words to the galaxy" value={market.radio} max={80} onChange={(v) => { market.radio = v }} />}
    </UiEntity>
  )
}

function Actions(props: { item: MarketItem }) {
  const { item } = props
  const phase = market.phase
  return (
    <UiEntity uiTransform={{ flexDirection: 'row', alignItems: 'center', margin: { top: px(8) } }}>
      {phase === 'browse' && <Button label="PETITION" primary enabled={!market.busy} onClick={() => void askQuote()} />}
      {phase === 'quoted' && <Button label={`OFFER ${item.mana} MANA`} primary enabled={!market.busy} onClick={() => void pay()} />}
      {phase === 'quoted' && <Button label="WITHDRAW" enabled={!market.busy} onClick={again} />}
      {phase === 'done' && <Button label="ANOTHER PETITION" enabled={!market.busy} onClick={again} />}
    </UiEntity>
  )
}

function Petition() {
  const item = market.selected
  if (!item) {
    return (
      <UiEntity uiTransform={{ flexDirection: 'column', width: '100%' }}>
        <Label value={decoded('hello', 'WE ARE LISTENING.')} fontSize={px(22)} font={MONO} color={LAVENDER} textAlign="top-left" uiTransform={{ height: px(40) }} />
        <Label
          value="The Eld were old when your sun was young. They usually trade in folded probabilities, borrowed futures and favours owed across eleven dimensions. You have none of these. They will, with enormous patience, accept MANA on Polygon, the way you might accept a nice rock from a child. Petition first: they say whether a thing can be done before anything changes hands."
          fontSize={px(15)} font={MONO} color={DIM} textAlign="top-left" textWrap="wrap" uiTransform={{ width: '100%', height: px(150) }}
        />
      </UiEntity>
    )
  }
  return (
    <UiEntity uiTransform={{ flexDirection: 'column', width: '100%' }}>
      <UiEntity uiTransform={{ flexDirection: 'row', height: px(36), alignItems: 'center' }}>
        <Label value={item.name.toUpperCase()} fontSize={px(20)} font={MONO} color={LAVENDER} textAlign="middle-left" uiTransform={{ flexGrow: 1 }} />
        <Label value={`${item.mana} MANA`} fontSize={px(18)} font={MONO} color={CYAN} textAlign="middle-right" />
      </UiEntity>
      <Label value={item.blurb} fontSize={px(15)} font={MONO} color={DIM} textAlign="top-left" textWrap="wrap" uiTransform={{ width: '100%', height: px(62), margin: { bottom: px(8) } }} />
      <Params item={item} />
      {market.summary !== '' && (
        <UiEntity uiTransform={{ width: '100%', flexDirection: 'column', padding: px(12), margin: { top: px(4), bottom: px(4) }, borderWidth: px(1), borderColor: CYAN, borderRadius: px(6) }}>
          <Label value={market.phase === 'done' ? 'IT IS DONE' : 'THEIR TERMS'} fontSize={px(12)} font={MONO} color={CYAN} textAlign="middle-left" uiTransform={{ height: px(18) }} />
          <Label value={decoded('summary', market.summary)} fontSize={px(16)} font={MONO} color={LAVENDER} textAlign="middle-left" textWrap="wrap" uiTransform={{ width: '100%' }} />
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
        uiTransform={{ width: px(W), height: px(H), flexDirection: 'column', padding: px(22), borderWidth: px(1), borderColor: EDGE, borderRadius: px(14) }}
        uiBackground={{ color: BG }}
      >
        {/* Header */}
        <UiEntity uiTransform={{ flexDirection: 'row', alignItems: 'center', height: px(52) }}>
          <UiEntity uiTransform={{ flexDirection: 'column', flexGrow: 1 }}>
            <Label value="T H E   E L D" fontSize={px(28)} font={MONO} color={LAVENDER} textAlign="middle-left" uiTransform={{ height: px(34) }} />
            <Label value="KARDASHEV III  ·  UNREGISTERED RELAY  ·  SIGNAL NOMINAL" fontSize={px(12)} font={MONO} color={DIM} textAlign="middle-left" uiTransform={{ height: px(18) }} />
          </UiEntity>
          <UiEntity uiTransform={{ width: px(42), height: px(42), justifyContent: 'center', alignItems: 'center', borderWidth: px(1), borderColor: EDGE, borderRadius: px(21) }} onMouseDown={closeMarket}>
            <Label value="X" fontSize={px(16)} font={MONO} color={LAVENDER} />
          </UiEntity>
        </UiEntity>
        <UiEntity uiTransform={{ width: '100%', height: px(1), margin: { top: px(12), bottom: px(14) } }} uiBackground={{ color: FAINT }} />
        {market.loading ? (
          <Label value={decoded('loading', 'OPENING A CHANNEL…')} fontSize={px(18)} font={MONO} color={VIOLET} textAlign="middle-left" uiTransform={{ height: px(40) }} />
        ) : (
          <UiEntity uiTransform={{ flexDirection: 'row', flexGrow: 1 }}>
            <UiEntity uiTransform={{ width: px(LIST_W), flexDirection: 'column', margin: { right: px(24) } }}>
              <Label value="WHAT THEY OFFER" fontSize={px(12)} font={MONO} color={FAINT} textAlign="middle-left" uiTransform={{ height: px(22), margin: { bottom: px(4) } }} />
              {market.items.map((item) => <ItemRow key={item.id} item={item} />)}
            </UiEntity>
            <UiEntity uiTransform={{ width: px(1), height: '100%', margin: { right: px(24) } }} uiBackground={{ color: FAINT }} />
            <UiEntity uiTransform={{ flexGrow: 1, flexShrink: 1, flexDirection: 'column' }}>
              <Petition />
            </UiEntity>
          </UiEntity>
        )}
        {/* Status and footer */}
        <UiEntity uiTransform={{ width: '100%', height: px(1), margin: { top: px(8), bottom: px(6) } }} uiBackground={{ color: FAINT }} />
        <Label value={decoded('message', market.message)} fontSize={px(15)} font={MONO} color={market.warn ? WARN : VIOLET} textAlign="middle-left" textWrap="wrap" uiTransform={{ width: '100%', height: px(42) }} />
        <Label value={market.mine} fontSize={px(13)} font={MONO} color={DIM} textAlign="middle-left" uiTransform={{ width: '100%', height: px(20) }} />
      </UiEntity>
    </UiEntity>
  )
}
