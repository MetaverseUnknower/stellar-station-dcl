// The Space Bar's menu: three of the Galaxy Gardeners launch party's Refinery Bar mocktails, with what's in them so
// players can make them at home, and a fourth that isn't a drink at all (it's how you ask for the back room: see
// secretDoor.ts). A drink comes as a glass in the right hand, kept upright, from The Silt's glass-in-hand
// (~/-Decentraland/Venues/The Silt src/venue.ts); The Silt's highball glasses are in assets/models/glasses.
import { engine, Entity, Transform, GltfContainer, AvatarAttach, AvatarAnchorPointType } from '@dcl/sdk/ecs'
import { Vector3, Quaternion, Color4 } from '@dcl/sdk/math'

export type Drink = {
  id: string
  name: string
  rarity: string
  rarityColour: Color4
  blurb: string
  ingredients: string[]
  method: string
  glass: string | null // null: there's nothing to hand you
  served: string // what DEX says as he serves it
}

// The game's rarity colours (stations/floraSpecies.ts)
const COMMON = Color4.create(0.6, 0.6, 0.6, 1)
const UNCOMMON = Color4.create(0.2, 0.8, 0.3, 1)
const MYTHIC = Color4.create(1, 0.3, 0.5, 1)
const CLASSIFIED = Color4.create(0.55, 0.3, 1, 1)

export const DRINKS: Drink[] = [
  {
    id: 'helium3',
    name: 'Helium-3 Fizz',
    rarity: 'COMMON',
    rarityColour: COMMON,
    blurb: 'Clear, blue and bubbly. Refined fresh from the belt.',
    ingredients: ['1 cup (8 oz) lemon-lime soda', '1 tbsp blue curaçao syrup (non-alcoholic)', 'Ice'],
    method: 'Syrup over ice, top with the soda, stir once.',
    glass: 'assets/models/glasses/lumen_rift_highball.glb',
    served: 'One Helium-3 Fizz. Mind the bubbles.'
  },
  {
    id: 'plasma',
    name: 'Plasma Crystal',
    rarity: 'UNCOMMON',
    rarityColour: UNCOMMON,
    blurb: 'Deep purple, sparkling, and it glows.',
    ingredients: ['½ cup (4 oz) purple grape juice', '½ cup (4 oz) sparkling water', 'Ice', 'A glow stick (outside the glass)'],
    method: 'Juice over ice, top with sparkling water. Wrap the glow stick round the glass.',
    glass: 'assets/models/glasses/nebula_tear_highball.glb',
    served: 'One Plasma Crystal. Do not look directly at it.'
  },
  {
    id: 'mythic',
    name: 'Mythic Bloom',
    rarity: 'MYTHIC',
    rarityColour: MYTHIC,
    blurb: 'Like a holographic specimen in a glass. Rarely seen.',
    ingredients: ['1 cup (8 oz) pink lemonade', '1 tbsp grenadine', 'Cotton candy for the rim', 'A pinch of edible glitter', 'Ice'],
    method: 'Glitter into the lemonade, pour over ice, let the grenadine sink. Cotton candy on the rim.',
    glass: 'assets/models/glasses/synapse_highball.glb',
    served: 'One Mythic Bloom. Very rare. Please don’t trade it.'
  },
  {
    id: 'vacuum',
    name: 'Vacuum on the Rocks, hold the rocks',
    rarity: 'CLASSIFIED',
    rarityColour: CLASSIFIED,
    blurb: 'The finest nothing in the quadrant.',
    ingredients: ['Nothing', 'Chilled'],
    method: 'Serve immediately, before it gets any emptier.',
    glass: null,
    served: '…Of course. Right this way.'
  }
]

const HOLD_SECONDS = 5 * 60 // a drink lasts five minutes

let anchor: Entity | null = null
let glass: Entity | null = null
let left = 0

/** Put a drink's glass in my right hand (replacing any glass I'm holding). */
export function holdGlass(src: string): void {
  dropGlass()
  anchor = engine.addEntity()
  AvatarAttach.create(anchor, { anchorPointId: AvatarAnchorPointType.AAPT_RIGHT_HAND })
  glass = engine.addEntity()
  Transform.create(glass, { scale: Vector3.create(0.15, 0.15, 0.15) })
  GltfContainer.create(glass, { src })
  left = HOLD_SECONDS
}

export function dropGlass(): void {
  if (glass) engine.removeEntity(glass)
  if (anchor) engine.removeEntity(anchor)
  glass = anchor = null
}

export function startDrinks(): void {
  // As at The Silt: follow the hand, but stay upright (a hand-attached glass tips over as the arm swings).
  engine.addSystem((dt) => {
    if (!anchor || !glass) return
    left -= dt
    if (left <= 0) {
      dropGlass()
      return
    }
    const hand = Transform.getOrNull(anchor)
    if (!hand) return
    const t = Transform.getMutable(glass)
    t.position = hand.position
    t.rotation = Quaternion.Identity()
  })
}
