// DEX's menu: the Space Bar's drinks, each with its rarity (in the game's colours), what's in it and how to make it
// at home, and an ORDER button. In the bar's colours: navy lacquer, brass, and its cyan and pink neon. The drinks
// are in drinks.ts; ordering is bartender.ts.
import ReactEcs, { UiEntity, Label } from '@dcl/sdk/react-ecs'
import { Color4 } from '@dcl/sdk/math'
import { engine, UiCanvasInformation } from '@dcl/sdk/ecs'
import { px as scaled } from '../uiScale'
import { DRINKS, Drink } from './drinks'
import { barMenu, closeBarMenu, order } from './bartender'

const NAVY = Color4.create(0.03, 0.06, 0.16, 0.96)
const CARD = Color4.create(0.05, 0.1, 0.24, 1)
const BRASS = Color4.create(0.85, 0.62, 0.28, 1)
const CREAM = Color4.create(1, 0.95, 0.85, 1)
const DIM = Color4.create(0.62, 0.68, 0.8, 1)
const CYAN = Color4.create(0.2, 0.9, 1, 1)
const PINK = Color4.create(1, 0.22, 0.7, 1)
const INK = Color4.create(0.02, 0.04, 0.1, 1)

const CARD_W = 400
const CARD_H = 222
const PANEL_W = 2 * (CARD_W + 12) + 36 // two cards a row, their margins, the panel's padding

// Sized for a 1080-tall screen (uiScale.ts), and shrunk further if the window is too narrow for the panel.
let fitK = 1
const px = (n: number) => Math.round(scaled(n) * fitK)
function fitToWindow(): void {
  const canvas = UiCanvasInformation.getOrNull(engine.RootEntity)
  const room = canvas && canvas.width > 0 ? canvas.width * 0.94 : Infinity
  fitK = Math.min(1, room / scaled(PANEL_W))
}

function DrinkCard(props: { key?: string; drink: Drink }) {
  const { drink } = props
  return (
    <UiEntity
      uiTransform={{ width: px(CARD_W), height: px(CARD_H), flexDirection: 'column', padding: px(12), margin: px(6), borderWidth: px(1), borderColor: BRASS, borderRadius: px(8) }}
      uiBackground={{ color: CARD }}
    >
      <UiEntity uiTransform={{ flexDirection: 'row', alignItems: 'center', height: px(30) }}>
        <Label value={drink.name} fontSize={px(16)} color={CREAM} textAlign="middle-left" uiTransform={{ flexGrow: 1, flexShrink: 1 }} />
        <UiEntity uiTransform={{ height: px(22), padding: { left: px(8), right: px(8) }, justifyContent: 'center', borderRadius: px(11) }} uiBackground={{ color: drink.rarityColour }}>
          <Label value={drink.rarity} fontSize={px(11)} color={INK} />
        </UiEntity>
      </UiEntity>
      <Label value={drink.blurb} fontSize={px(12)} color={DIM} textAlign="top-left" textWrap="wrap" uiTransform={{ width: '100%', height: px(20) }} />
      <Label value="MAKE IT AT HOME" fontSize={px(11)} color={BRASS} textAlign="middle-left" uiTransform={{ height: px(20), margin: { top: px(4) } }} />
      <Label value={drink.ingredients.map((i) => `·  ${i}`).join('\n')} fontSize={px(12)} color={CREAM} textAlign="top-left" uiTransform={{ width: '100%', height: px(76) }} />
      <UiEntity uiTransform={{ flexDirection: 'row', alignItems: 'flex-end', flexGrow: 1 }}>
        <Label value={drink.method} fontSize={px(11)} color={DIM} textAlign="bottom-left" textWrap="wrap" uiTransform={{ flexGrow: 1, flexShrink: 1, height: '100%', margin: { right: px(10) } }} />
        <UiEntity
          uiTransform={{ height: px(30), padding: { left: px(16), right: px(16) }, justifyContent: 'center', alignItems: 'center', borderRadius: px(15), flexShrink: 0 }}
          uiBackground={{ color: drink.glass ? PINK : CYAN }}
          onMouseDown={() => order(drink)}
        >
          <Label value="ORDER" fontSize={px(14)} color={INK} />
        </UiEntity>
      </UiEntity>
    </UiEntity>
  )
}

export function BarMenu() {
  if (!barMenu.open) return null
  fitToWindow()
  return (
    // Pinned to the whole screen and centred both ways
    <UiEntity uiTransform={{ positionType: 'absolute', position: { top: 0, left: 0 }, width: '100%', height: '100%', justifyContent: 'center', alignItems: 'center', flexDirection: 'column' }}>
      <UiEntity
        uiTransform={{ width: px(PANEL_W), flexDirection: 'column', alignItems: 'center', padding: px(16), borderWidth: px(2), borderColor: BRASS, borderRadius: px(12) }}
        uiBackground={{ color: NAVY }}
      >
        <UiEntity uiTransform={{ width: '100%', flexDirection: 'row', alignItems: 'center', height: px(44), padding: { left: px(6), right: px(6) } }}>
          <UiEntity uiTransform={{ flexDirection: 'column', flexGrow: 1 }}>
            <Label value="THE SPACE BAR" fontSize={px(22)} color={PINK} textAlign="middle-left" uiTransform={{ height: px(30) }} />
            <Label value="Refinery mocktails, mixed by DEX  ·  on the house" fontSize={px(13)} color={CYAN} textAlign="middle-left" uiTransform={{ height: px(18) }} />
          </UiEntity>
          <UiEntity uiTransform={{ width: px(40), height: px(40), justifyContent: 'center', alignItems: 'center', borderWidth: px(1), borderColor: BRASS, borderRadius: px(20) }} onMouseDown={closeBarMenu}>
            <Label value="X" fontSize={px(16)} color={CREAM} />
          </UiEntity>
        </UiEntity>
        <UiEntity uiTransform={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', width: px(2 * (CARD_W + 12)), margin: { top: px(6) } }}>
          {DRINKS.map((d) => <DrinkCard key={d.id} drink={d} />)}
        </UiEntity>
      </UiEntity>
    </UiEntity>
  )
}
