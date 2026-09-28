// The Space Bar's menu: three of the Galaxy Gardeners launch party's Refinery Bar mocktails, with what's in them so
// players can make them at home, and a fourth that isn't a drink at all (it's how you ask for the back room: see
// secretDoor.ts). A drink comes as a glass in the right hand: The Silt's highball glasses (assets/models/glasses).
// The Silt copied the hand anchor's Transform onto the glass every frame, but the explorer never writes an attached
// entity's Transform back to the scene, so that glass never left the scene's origin. Here the glass is a child of the
// hand anchor instead, and the explorer carries it.
//
// Stand still with a drink and you drink it: the drink's emote (tools/build_drink_emote.py: held at the chest, a sip
// every eight seconds) plays on a loop, with its own glass as the emote's prop, so the hand's glass hides meanwhile.
// Walk and it stops (the explorer ends emotes on movement) and the hand's glass is back. Play any other emote and you
// drop it: it smashes on the floor and "You dropped your drink..." (sitting down in one of the scene's seats is fine).
import {
  engine, Entity, Transform, GltfContainer, AvatarAttach, AvatarAnchorPointType, AvatarEmoteCommand, AudioSource,
  MeshRenderer, Material, MaterialTransparencyMode, Tween, EasingFunction
} from '@dcl/sdk/ecs'
import { Vector3, Quaternion, Color3, Color4 } from '@dcl/sdk/math'
import { triggerSceneEmote } from '~system/RestrictedActions'
import { isSeated } from '../seating'

// The glasses are modelled lying along +Z with the base at the origin (0.24 m long at GLASS_SCALE): stand them up.
const GLASS_SCALE = 0.15
const IN_HAND = { position: Vector3.create(0, -0.06, 0), rotation: Quaternion.fromEulerDegrees(-90, 0, 0) }

export type Drink = {
  id: string
  name: string
  rarity: string
  rarityColour: Color4
  blurb: string
  ingredients: string[]
  method: string
  glass: string | null // null: there's nothing to hand you
  emote: string | null // the drinking emote, with this drink's glass
  colour: Color3 // the drink's, for the shards when it's dropped
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
    emote: 'assets/emotes/helium3_emote.glb',
    colour: Color3.create(0.2, 0.75, 1),
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
    emote: 'assets/emotes/plasma_emote.glb',
    colour: Color3.create(0.55, 0.2, 0.95),
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
    emote: 'assets/emotes/mythic_emote.glb',
    colour: Color3.create(1, 0.35, 0.7),
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
    emote: null,
    colour: Color3.Black(),
    served: '' // DEX has a whole routine for this one (bartender.ts)
  }
]

const HOLD_SECONDS = 5 * 60 // a drink lasts five minutes
const STILL_SECONDS = 1.0 // standing still this long starts the drinking emote
const STILL_METRES = 0.03 // moved less than this since the last check: still
const MOVED_METRES = 0.12 // moved this far from where the emote started: it's over (the explorer has stopped it)
const OURS_SECONDS = 2 // an emote command this soon after we triggered ours is ours
const NOTICE_SECONDS = 3.5
const GLASS_BREAK = 'assets/audio/glass_break.mp3'

let holding: Drink | null = null
let anchor: Entity | null = null
let glass: Entity | null = null
let left = 0
let drinkingAt: Vector3 | null = null // where the drinking emote started, while it plays
let triggeredAt = -Infinity
let clock = 0

/** "You dropped your drink..." while it's showing (menuUi.tsx draws it). */
export const dropNotice = { text: '', left: 0 }

/** Hand me a drink (replacing any I'm holding). */
export function holdDrink(drink: Drink): void {
  if (!drink.glass) return
  finishDrink()
  holding = drink
  anchor = engine.addEntity()
  AvatarAttach.create(anchor, { anchorPointId: AvatarAnchorPointType.AAPT_RIGHT_HAND })
  glass = engine.addEntity()
  Transform.create(glass, { parent: anchor, ...IN_HAND, scale: Vector3.create(GLASS_SCALE, GLASS_SCALE, GLASS_SCALE) })
  GltfContainer.create(glass, { src: drink.glass })
  left = HOLD_SECONDS
  drinkingAt = null
}

/** The drink's gone (finished, or replaced). */
export function finishDrink(): void {
  if (glass) engine.removeEntity(glass)
  if (anchor) engine.removeEntity(anchor)
  glass = anchor = null
  holding = null
  drinkingAt = null
}

/** The hand's glass shows except while the drinking emote (and its own glass) plays. */
function showHandGlass(show: boolean): void {
  if (!glass) return
  const s = show ? GLASS_SCALE : 0
  if (Transform.get(glass).scale.x !== s) Transform.getMutable(glass).scale = Vector3.create(s, s, s)
}

/** Smash: the glass drops from about hand height beside me and shatters, with a crash, and a notice. */
function dropDrink(): void {
  const drink = holding
  const me = Transform.getOrNull(engine.PlayerEntity)
  finishDrink()
  if (!drink || !me) return
  dropNotice.text = 'You dropped your drink\u2026'
  dropNotice.left = NOTICE_SECONDS

  const speaker = engine.addEntity()
  Transform.create(speaker, { position: me.position })
  AudioSource.create(speaker, { audioClipUrl: GLASS_BREAK, playing: true, loop: false, volume: 1, global: true })

  // Where the hand would be: a little to my right and forward, at about waist height; the floor under my feet
  const right = Vector3.rotate(Vector3.create(0.25, 0, 0.2), me.rotation)
  const from = Vector3.add(me.position, Vector3.create(right.x, 0.15, right.z))
  const floor = me.position.y - 0.85
  const falling = engine.addEntity()
  Transform.create(falling, { position: from, rotation: Quaternion.fromEulerDegrees(-90, 0, 0), scale: Vector3.create(GLASS_SCALE, GLASS_SCALE, GLASS_SCALE) })
  GltfContainer.create(falling, { src: drink.glass as string })
  Tween.create(falling, {
    mode: Tween.Mode.Move({ start: from, end: Vector3.create(from.x, floor + 0.02, from.z) }),
    duration: 280,
    easingFunction: EasingFunction.EF_EASEINQUAD
  })
  pieces.push({ e: falling, at: clock, kind: 'glass', drink, floor: Vector3.create(from.x, floor, from.z) })
  cleanup.push({ e: speaker, at: clock + 3 })
}

type Piece = { e: Entity; at: number; kind: 'glass'; drink: Drink; floor: Vector3 }
const pieces: Piece[] = []
const cleanup: { e: Entity; at: number }[] = []

/** The glass has hit the floor: swap it for shards skittering out, and a splash of the drink, all fading away. */
function shatter(p: Piece): void {
  engine.removeEntity(p.e)
  const splash = engine.addEntity()
  Transform.create(splash, { position: Vector3.add(p.floor, Vector3.create(0, 0.012, 0)), rotation: Quaternion.fromEulerDegrees(90, 0, 0), scale: Vector3.create(0.4, 0.3, 1) })
  MeshRenderer.setPlane(splash)
  Material.setPbrMaterial(splash, {
    albedoColor: Color4.create(p.drink.colour.r, p.drink.colour.g, p.drink.colour.b, 0.6),
    emissiveColor: p.drink.colour,
    emissiveIntensity: 0.6,
    transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND
  })
  cleanup.push({ e: splash, at: clock + 6 })
  for (let i = 0; i < 9; i++) {
    const shard = engine.addEntity()
    const a = (i / 9) * Math.PI * 2 + Math.random() * 0.5
    const r = 0.25 + Math.random() * 0.45
    const start = Vector3.add(p.floor, Vector3.create(0, 0.03, 0))
    const end = Vector3.add(p.floor, Vector3.create(Math.cos(a) * r, 0.01, Math.sin(a) * r))
    const size = 0.015 + Math.random() * 0.025
    Transform.create(shard, { position: start, scale: Vector3.create(size, 0.004, size * 1.6), rotation: Quaternion.fromEulerDegrees(0, Math.random() * 360, 0) })
    MeshRenderer.setBox(shard)
    Material.setPbrMaterial(shard, {
      albedoColor: Color4.create(0.85, 0.95, 1, 0.55),
      emissiveColor: Color3.create(0.5, 0.6, 0.7),
      emissiveIntensity: 0.4,
      metallic: 0.2,
      roughness: 0.05,
      transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND
    })
    Tween.create(shard, { mode: Tween.Mode.Move({ start, end }), duration: 220 + Math.random() * 260, easingFunction: EasingFunction.EF_EASEOUTQUAD })
    cleanup.push({ e: shard, at: clock + 6 })
  }
}

export function startDrinks(): void {
  let lastPos: Vector3 | null = null
  let still = 0
  let lastEmote = -1
  engine.addSystem((dt) => {
    clock += dt

    for (let i = pieces.length - 1; i >= 0; i--) {
      if (clock - pieces[i].at > 0.3) shatter(pieces.splice(i, 1)[0])
    }
    for (let i = cleanup.length - 1; i >= 0; i--) {
      if (clock >= cleanup[i].at) engine.removeEntity(cleanup.splice(i, 1)[0].e)
    }
    if (dropNotice.left > 0) {
      dropNotice.left -= dt
      if (dropNotice.left <= 0) dropNotice.text = ''
    }

    // Emotes I play: ours (the drinking one, just triggered) or sitting down are fine; anything else drops the drink.
    for (const cmd of AvatarEmoteCommand.get(engine.PlayerEntity)) {
      if (cmd.timestamp <= lastEmote) continue
      lastEmote = cmd.timestamp
      const ours = clock - triggeredAt < OURS_SECONDS || /scene-emote|_emote\.glb/i.test(cmd.emoteUrn)
      const sitting = /sitting/i.test(cmd.emoteUrn)
      if (holding && !ours && !sitting) {
        console.log('[drinks] dropped by emote', cmd.emoteUrn)
        dropDrink()
      }
    }

    if (!holding || !glass) return
    left -= dt
    if (left <= 0) {
      finishDrink()
      return
    }

    // Standing still: drink. Moving (or sitting): hold it.
    const me = Transform.getOrNull(engine.PlayerEntity)
    if (!me) return
    const moved = lastPos ? Vector3.distance(me.position, lastPos) : 0
    lastPos = me.position
    if (drinkingAt && Vector3.distance(me.position, drinkingAt) > MOVED_METRES) drinkingAt = null
    still = moved < STILL_METRES * Math.max(1, dt * 60) ? still + dt : 0
    if (!drinkingAt && still >= STILL_SECONDS && !isSeated() && holding.emote) {
      drinkingAt = me.position
      triggeredAt = clock
      void triggerSceneEmote({ src: holding.emote, loop: true })
    }
    showHandGlass(!drinkingAt)
  })
}
