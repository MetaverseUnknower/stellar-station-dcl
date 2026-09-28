// DEX's menu: the Space Bar's drinks, each with its rarity (in the game's colours), what's in it and how to make it
// at home, and an ORDER button. In the bar's colours: navy lacquer, brass, and its cyan and pink neon. The drinks
// are in drinks.ts; ordering is bartender.ts.
import ReactEcs, { UiEntity, Label } from '@dcl/sdk/react-ecs'
import { Color4 } from '@dcl/sdk/math'
import { px } from '../uiScale'
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

const CARD_W = 500
const CARD_H = 250

function DrinkCard(props: { key?: string; drink: Drink }) {
  const { drink } = props
  return (
    <UiEntity
      uiTransform={{ width: px(CARD_W), height: px(CARD_H), flexDirection: 'column', padding: px(16), margin: px(8), borderWidth: px(1), borderColor: BRASS, borderRadius: px(8) }}
      uiBackground={{ color: CARD }}
    >
      <UiEntity uiTransform={{ flexDirection: 'row', alignItems: 'center', height: px(30) }}>
        <Label value={drink.name} fontSize={px(19)} color={CREAM} textAlign="middle-left" uiTransform={{ flexGrow: 1, flexShrink: 1 }} />
        <UiEntity uiTransform={{ height: px(22), padding: { left: px(8), right: px(8) }, justifyContent: 'center', borderRadius: px(11) }} uiBackground={{ color: drink.rarityColour }}>
          <Label value={drink.rarity} fontSize={px(11)} color={INK} />
        </UiEntity>
      </UiEntity>
      <Label value={drink.blurb} fontSize={px(14)} color={DIM} textAlign="top-left" textWrap="wrap" uiTransform={{ width: '100%', height: px(24) }} />
      <Label value="MAKE IT AT HOME" fontSize={px(11)} color={BRASS} textAlign="middle-left" uiTransform={{ height: px(20), margin: { top: px(4) } }} />
      <Label value={drink.ingredients.map((i) => `·  ${i}`).join('\n')} fontSize={px(13)} color={CREAM} textAlign="top-left" uiTransform={{ width: '100%', height: px(78) }} />
      <UiEntity uiTransform={{ flexDirection: 'row', alignItems: 'flex-end', flexGrow: 1 }}>
        <Label value={drink.method} fontSize={px(12)} color={DIM} textAlign="bottom-left" textWrap="wrap" uiTransform={{ flexGrow: 1, flexShrink: 1, height: '100%', margin: { right: px(10) } }} />
        <UiEntity
          uiTransform={{ height: px(34), padding: { left: px(18), right: px(18) }, justifyContent: 'center', alignItems: 'center', borderRadius: px(17), flexShrink: 0 }}
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
  return (
    <UiEntity uiTransform={{ positionType: 'absolute', width: '100%', height: '100%', justifyContent: 'center', alignItems: 'center' }}>
      <UiEntity
        uiTransform={{ flexDirection: 'column', padding: px(18), borderWidth: px(2), borderColor: BRASS, borderRadius: px(12) }}
        uiBackground={{ color: NAVY }}
      >
        <UiEntity uiTransform={{ flexDirection: 'row', alignItems: 'center', height: px(44), margin: { left: px(8), right: px(8) } }}>
          <UiEntity uiTransform={{ flexDirection: 'column', flexGrow: 1 }}>
            <Label value="THE SPACE BAR" fontSize={px(26)} color={PINK} textAlign="middle-left" uiTransform={{ height: px(30) }} />
            <Label value="Refinery mocktails, mixed by DEX  ·  on the house" fontSize={px(13)} color={CYAN} textAlign="middle-left" uiTransform={{ height: px(18) }} />
          </UiEntity>
          <UiEntity uiTransform={{ width: px(40), height: px(40), justifyContent: 'center', alignItems: 'center', borderWidth: px(1), borderColor: BRASS, borderRadius: px(20) }} onMouseDown={closeBarMenu}>
            <Label value="X" fontSize={px(16)} color={CREAM} />
          </UiEntity>
        </UiEntity>
        <UiEntity uiTransform={{ flexDirection: 'row', flexWrap: 'wrap', width: px(2 * (CARD_W + 16)), margin: { top: px(8) } }}>
          {DRINKS.map((d) => <DrinkCard key={d.id} drink={d} />)}
        </UiEntity>
      </UiEntity>
    </UiEntity>
  )
}
