// Galaxy Gardeners — The fuel dispenser panel: the retro frame from the user's mockup, with content that switches
// between giveaway, store, closed and register-first. State and actions live in fuelPanel.ts.
import ReactEcs, { UiEntity, Input } from '@dcl/sdk/react-ecs'
import { Color4 } from '@dcl/sdk/math'
import {
  fuelPanel,
  getPanelMode,
  closeFuelPanel,
  claimSceneFuel,
  submitCode,
  buyTier,
  isDispenserOperator,
  toggleDispenser,
  declineGiveaway,
  showCodeEntry,
  backToStore
} from './fuelPanel'
import { getLiveSceneDrop, isDispenserEnabled, DISPENSER_CLOSED } from './fuelDrops'
import { MANA_TIERS, type ManaTier } from './payments'

// ── Textures ──
const BG_TEXTURE = 'assets/textures/fuel-cell-ui-bg.png' // 1672×941, title + tagline baked into the top
const ATLAS_TEXTURE = 'assets/textures/fuel-cell-ui-atlas.png' // 1672×941, Redeem and Close buttons
const CLAIM_TEXTURE = 'assets/textures/fuel-cell-ui-free-button.png' // 2172×724, text-free red button

/**
 * UVs for a pixel box of an image. UiBackground.uvs takes four (u, v) pairs starting at the bottom-left vertex and
 * going clockwise (bottom-left, top-left, top-right, bottom-right), with v = 0 at the image's BOTTOM edge, so image
 * rows (y down) are flipped: v = 1 - y / height.
 */
function pixelUvs(x0: number, y0: number, x1: number, y1: number, width: number, height: number): number[] {
  const u0 = x0 / width
  const u1 = x1 / width
  const vTop = 1 - y0 / height
  const vBottom = 1 - y1 / height
  return [u0, vBottom, u0, vTop, u1, vTop, u1, vBottom]
}

// Measured from the images' alpha, padded a few px so the glow isn't clipped
const REDEEM_UVS = pixelUvs(198, 130, 1474, 483, 1672, 941) // 1276×353 → 3.61:1
const CLOSE_UVS = pixelUvs(159, 560, 1512, 826, 1672, 941) // 1353×266 → 5.09:1
// The claim art is mostly transparent above and below the button; crop to it (2140×420 → 5.10:1)
const CLAIM_UVS = pixelUvs(16, 136, 2156, 556, 2172, 724)

// ── Layout (px). Panel keeps the bg's 1672:941 aspect; scale = 800 / 1672 ≈ 0.4785 ──
const PANEL_W = 800
const PANEL_H = 450
// Content sits over the dark inner panel below the tagline: image x 130..1540, y ~420..800
const CONTENT_LEFT = 64
const CONTENT_TOP = 200
const CONTENT_W = 672
const CONTENT_H = 182
// Rows, top to bottom (sum = CONTENT_H): hero 78 | link 36 | status 36 | close 32
const HERO_H = 78
const CLAIM_W = 400
const CODE_H = 38
const INPUT_W = 460
const REDEEM_W = 138
const STATUS_H = 36
const CLOSE_H = 32
// The giveaway screen swaps the hero row for a short text link (36px): 78 | 36 | 36 | 32 = 182, unchanged.
// The code screen: code row 38 + a margin-top of 18 to sit it lower | back-link 58 | status 36 | close 32 = 182.
// The store screen has its own row heights below (STORE_*), since its cards need less room than the hero row.
const LINK_H = 36
const BACK_LINK_H = 58
const CODE_ROW_TOP_PAD = 18
const CLOSE_W = 162
const RULE_W = 120
const CARD_W = 216
const CARD_GAP = 12

// ── Colours ──
const CREAM = Color4.create(1, 0.953, 0.863, 1) // #FFF3DC
const CYAN = Color4.create(0.24, 0.86, 0.9, 1)
const FIELD_BG = Color4.create(0.01, 0.13, 0.17, 0.95)
const CARD_BG = Color4.create(0.02, 0.2, 0.25, 0.9)
const PLACEHOLDER = Color4.create(0.42, 0.7, 0.72, 1)
const GOLD = Color4.create(0.93, 0.72, 0.36, 1)
const BUY_RED = Color4.create(0.86, 0.27, 0.18, 1)
const ON_GREEN = Color4.create(0.1, 0.45, 0.3, 1)
const OFF_RED = Color4.create(0.55, 0.13, 0.1, 1)

function ClaimButton() {
  const drop = getLiveSceneDrop()
  const cells = drop?.cells ?? 0
  return (
    <UiEntity
      uiTransform={{ width: CLAIM_W, height: HERO_H, justifyContent: 'center', alignItems: 'center', opacity: fuelPanel.busy ? 0.7 : 1 }}
      uiBackground={{ textureMode: 'stretch', texture: { src: CLAIM_TEXTURE }, uvs: CLAIM_UVS }}
      onMouseDown={claimSceneFuel}
    >
      {/* Stars sit at ~6% and ~94% of the art; keep the text inside 12%..88% */}
      <UiEntity
        uiTransform={{ width: CLAIM_W * 0.76, height: HERO_H }}
        uiText={{ value: `Claim ${cells} free Fuel Cell${cells === 1 ? '' : 's'}`, fontSize: 22, color: CREAM, textAlign: 'middle-center' }}
      />
    </UiEntity>
  )
}

function TierCard(props: { key?: string; tier: ManaTier; last: boolean }) {
  const { tier } = props
  return (
    <UiEntity
      uiTransform={{
        width: CARD_W,
        height: STORE_HERO_H,
        flexDirection: 'row',
        alignItems: 'center',
        padding: 3,
        margin: { right: props.last ? 0 : CARD_GAP },
        borderRadius: 10,
        borderWidth: 1,
        borderColor: CYAN
      }}
      uiBackground={{ color: CARD_BG }}
    >
      <UiEntity uiTransform={{ width: 64, height: 64, flexShrink: 0 }} uiBackground={{ textureMode: 'stretch', texture: { src: tier.image } }} />
      <UiEntity uiTransform={{ width: 128, height: 66, flexDirection: 'column', margin: { left: 6 } }}>
        <UiEntity uiTransform={{ width: '100%', height: 16 }} uiText={{ value: tier.name, fontSize: 11, color: CREAM, textAlign: 'middle-left', textWrap: 'nowrap' }} />
        <UiEntity
          uiTransform={{ width: '100%', height: 16 }}
          uiText={{ value: `${tier.cells} Fuel Cell${tier.cells === 1 ? '' : 's'}`, fontSize: 11, color: PLACEHOLDER, textAlign: 'middle-left' }}
        />
        <UiEntity
          uiTransform={{
            width: 104,
            height: 28,
            margin: { top: 6 },
            borderRadius: 14,
            borderWidth: 1,
            borderColor: CREAM,
            opacity: fuelPanel.busy ? 0.6 : 1
          }}
          uiBackground={{ color: BUY_RED }}
          uiText={{ value: `${tier.mana} MANA`, fontSize: 13, color: CREAM, textAlign: 'middle-center' }}
          onMouseDown={() => void buyTier(tier)}
        />
      </UiEntity>
    </UiEntity>
  )
}

// Store screen: its own row budget, redistributed for more breathing room above the cards and a shorter
// "Redeem a code" link: pad 22 | cards 72 | link 24 | status 32 | close 32 = 182.
const STORE_TOP_PAD = 22
const STORE_HERO_H = 72
const STORE_LINK_H = LINK_H - 12 // 24
const STORE_STATUS_H = 32

function TierRow() {
  return (
    <UiEntity uiTransform={{ width: CONTENT_W, height: STORE_HERO_H, flexDirection: 'row', justifyContent: 'center', margin: { top: STORE_TOP_PAD } }}>
      {MANA_TIERS.map((tier, i) => (
        <TierCard key={tier.id} tier={tier} last={i === MANA_TIERS.length - 1} />
      ))}
    </UiEntity>
  )
}

function CodeRow() {
  return (
    <UiEntity uiTransform={{ width: CONTENT_W, height: CODE_H, flexDirection: 'row', justifyContent: 'center', margin: { top: CODE_ROW_TOP_PAD } }}>
      <Input
        placeholder="Enter a code"
        placeholderColor={PLACEHOLDER}
        value={fuelPanel.code}
        onChange={(value) => {
          fuelPanel.code = value
        }}
        onSubmit={() => submitCode()}
        fontSize={15}
        color={CREAM}
        textAlign="middle-left"
        uiTransform={{ width: INPUT_W, height: CODE_H, padding: { left: 14, right: 14 }, borderRadius: 12, borderWidth: 2, borderColor: CYAN }}
        uiBackground={{ color: FIELD_BG }}
      />
      <UiEntity
        uiTransform={{ width: REDEEM_W, height: CODE_H, margin: { left: 12 }, opacity: fuelPanel.busy ? 0.7 : 1 }}
        uiBackground={{ textureMode: 'stretch', texture: { src: ATLAS_TEXTURE }, uvs: REDEEM_UVS }}
        onMouseDown={submitCode}
      />
    </UiEntity>
  )
}

const LINK_HIT_W = 140
const LINK_HIT_H = 24
const STATUS_MAX_CHARS = 150

/** Caps any player-facing panel message at STATUS_MAX_CHARS, e.g. a long wallet-rejection message. */
function capMessage(text: string): string {
  return text.length > STATUS_MAX_CHARS ? `${text.slice(0, STATUS_MAX_CHARS - 1)}…` : text
}

/**
 * A small cream text link, e.g. "No thanks ›", "Redeem a code ›" or "‹ Back". No underline in this SDK's uiText,
 * so direction reads from the arrow instead. The slot spans the full content width so Close stays put across
 * screens, but only a small centred child is clickable, so the hit area matches what's visibly a link.
 */
function TextLink(props: { text: string; height: number; onMouseDown: () => void }) {
  return (
    <UiEntity uiTransform={{ width: CONTENT_W, height: props.height, justifyContent: 'center', alignItems: 'center' }}>
      <UiEntity
        uiTransform={{ width: LINK_HIT_W, height: LINK_HIT_H, justifyContent: 'center', alignItems: 'center' }}
        uiText={{ value: props.text, fontSize: 14, color: CREAM, textAlign: 'middle-center' }}
        onMouseDown={props.onMouseDown}
      />
    </UiEntity>
  )
}

function StatusLine(props?: { height?: number }) {
  const raw = fuelPanel.message || (fuelPanel.busy ? 'Working…' : '')
  const text = capMessage(raw)
  return (
    <UiEntity
      uiTransform={{ width: CONTENT_W, height: props?.height ?? STATUS_H }}
      uiText={{ value: text, fontSize: 13, color: fuelPanel.message ? CREAM : PLACEHOLDER, textAlign: 'middle-center', textWrap: 'wrap' }}
    />
  )
}

/** Fills the hero + link + status slots with a single centred message (loading, register-first, closed) */
function MessageBlock(props: { text: string; detail?: string }) {
  return (
    <UiEntity uiTransform={{ width: CONTENT_W, height: HERO_H + LINK_H + STATUS_H, flexDirection: 'column', justifyContent: 'center', alignItems: 'center' }}>
      <UiEntity uiTransform={{ width: CONTENT_W - 40, height: 'auto' }} uiText={{ value: capMessage(props.text), fontSize: 18, color: CREAM, textAlign: 'middle-center', textWrap: 'wrap' }} />
      {props.detail ? (
        <UiEntity
          uiTransform={{ width: CONTENT_W - 40, height: 'auto', margin: { top: 8 } }}
          uiText={{ value: capMessage(props.detail), fontSize: 13, color: PLACEHOLDER, textAlign: 'middle-center', textWrap: 'wrap' }}
        />
      ) : null}
    </UiEntity>
  )
}

function CloseRow() {
  return (
    <UiEntity uiTransform={{ width: CONTENT_W, height: CLOSE_H, flexDirection: 'row', justifyContent: 'center', alignItems: 'center' }}>
      <UiEntity uiTransform={{ width: RULE_W, height: 2, margin: { right: 20 } }} uiBackground={{ color: GOLD }} />
      <UiEntity
        uiTransform={{ width: CLOSE_W, height: CLOSE_H }}
        uiBackground={{ textureMode: 'stretch', texture: { src: ATLAS_TEXTURE }, uvs: CLOSE_UVS }}
        onMouseDown={closeFuelPanel}
      />
      <UiEntity uiTransform={{ width: RULE_W, height: 2, margin: { left: 20 } }} uiBackground={{ color: GOLD }} />
    </UiEntity>
  )
}

/** Operators only; the server enforces who may flip it */
function OperatorToggle() {
  if (!isDispenserOperator()) return null
  const on = isDispenserEnabled()
  return (
    <UiEntity
      uiTransform={{
        width: 118,
        height: 22,
        positionType: 'absolute',
        position: { top: 62, right: 62 },
        borderRadius: 11,
        borderWidth: 1,
        borderColor: CREAM,
        opacity: fuelPanel.toggling ? 0.6 : 1
      }}
      uiBackground={{ color: on ? ON_GREEN : OFF_RED }}
      uiText={{ value: fuelPanel.toggling ? 'Dispenser: …' : `Dispenser: ${on ? 'ON' : 'OFF'}`, fontSize: 11, color: CREAM, textAlign: 'middle-center' }}
      onMouseDown={() => void toggleDispenser()}
    />
  )
}

function PanelContent() {
  const mode = getPanelMode()
  switch (mode) {
    case 'loading':
      return <MessageBlock text="Working…" />
    case 'register':
      return <MessageBlock text={fuelPanel.message} />
    case 'closed':
      return <MessageBlock text={DISPENSER_CLOSED} detail={fuelPanel.message && fuelPanel.message !== DISPENSER_CLOSED ? fuelPanel.message : undefined} />
    case 'giveaway':
      return (
        <UiEntity uiTransform={{ width: CONTENT_W, flexDirection: 'column', alignItems: 'center' }}>
          <ClaimButton />
          <TextLink text="No thanks ›" height={LINK_H} onMouseDown={declineGiveaway} />
          <StatusLine />
        </UiEntity>
      )
    case 'store':
      return (
        <UiEntity uiTransform={{ width: CONTENT_W, flexDirection: 'column', alignItems: 'center' }}>
          <TierRow />
          <TextLink text="Redeem a code ›" height={STORE_LINK_H} onMouseDown={showCodeEntry} />
          <StatusLine height={STORE_STATUS_H} />
        </UiEntity>
      )
    case 'code':
      return (
        <UiEntity uiTransform={{ width: CONTENT_W, flexDirection: 'column', alignItems: 'center' }}>
          <CodeRow />
          <TextLink text="‹ Back" height={BACK_LINK_H} onMouseDown={backToStore} />
          <StatusLine />
        </UiEntity>
      )
  }
}

export function FuelPanel() {
  if (!fuelPanel.open) return null
  return (
    <UiEntity
      uiTransform={{
        width: PANEL_W,
        height: PANEL_H,
        positionType: 'absolute',
        position: { right: 24, top: '50%' },
        margin: { top: -PANEL_H / 2 }
      }}
      uiBackground={{ textureMode: 'stretch', texture: { src: BG_TEXTURE } }}
    >
      <UiEntity
        uiTransform={{
          width: CONTENT_W,
          height: CONTENT_H,
          positionType: 'absolute',
          position: { left: CONTENT_LEFT, top: CONTENT_TOP },
          flexDirection: 'column',
          alignItems: 'center'
        }}
      >
        <PanelContent />
        <CloseRow />
      </UiEntity>
      <OperatorToggle />
    </UiEntity>
  )
}
