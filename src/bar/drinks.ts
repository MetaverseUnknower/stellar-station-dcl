// The Space Bar's menu: three of the Galaxy Gardeners launch party's Refinery Bar mocktails, with what's in them so
// players can make them at home, and a fourth that isn't a drink at all (it's how you ask for the back room: see
// secretDoor.ts). A drink comes as a glass in the right hand: The Silt's highball glasses (assets/models/glasses).
// The Silt copied the hand anchor's Transform onto the glass every frame, but the explorer never writes an attached
// entity's Transform back to the scene, so that glass never left the scene's origin. Here the glass is a child of the
// hand anchor instead, and the explorer carries it.
//
// Stand still with a drink and you drink it: the drink's emote (tools/build_drink_emote.py: held at the chest, a sip
// every eight seconds, swaying like someone at a club) plays on a loop, with its own glass as the emote's prop, so the
// hand's glass hides meanwhile. Sit in one of the scene's seats and it's the sitting version. Walk and it stops (the
// explorer ends emotes on movement) and the hand's glass is back. Play any other emote and you drop it: it smashes on
// the floor and "You dropped your drink..." (sitting down in one of the scene's seats is fine).
//
// Everyone sees everyone's drinks. The emotes are broadcast by the explorer (to everyone near); the hand's glass is
// shared with syncEntity (an AvatarAttach naming my avatar, which every client attaches to my hand), and so is a
// dropped drink (a DrinkDrop, which every client smashes where it fell, with the crash). Only for the crew docked at
// the same station: the world is one room for every station (audience.ts hides everyone else's avatars), so anyone
// else's glass or smash is hidden or skipped here, as is the glass of someone who's left with it still in hand.
import {
  engine, Entity, Transform, GltfContainer, AvatarAttach, AvatarAnchorPointType, AvatarEmoteCommand, AudioSource,
  VisibilityComponent, PlayerIdentityData, Schemas,
  MeshRenderer, Material, MaterialTransparencyMode, Tween, EasingFunction
} from '@dcl/sdk/ecs'
import { Vector3, Quaternion, Color3, Color4 } from '@dcl/sdk/math'
import { triggerSceneEmote } from '~system/RestrictedActions'
import { getPlayer } from '@dcl/sdk/players'
import { syncEntity, parentEntity, getParent } from '@dcl/sdk/network'
import { isSeated, setSitHook, seatPlace } from '../seating'
import { movePlayerTo } from '~system/RestrictedActions'
import { getCrew } from '../audience'

// The glasses are modelled lying along +Z with the base at the origin (0.24 m long at GLASS_SCALE). Held at rest
// (walking about, arm down), the glass sticks straight out of the fist at right angles to the arm, its base in the
// grip: left along the hand anchor's +Z. (Stood up along the anchor's Y, it hung down the arm and didn't look held.)
// The anchor is at the wrist, so the glass goes down the hand (the anchor's +Y, toward the fingers: along it, the glass
// had hung below the hand rather than running up the arm) into the fist, or it sat in the forearm.
const GLASS_SCALE = 0.15
const IN_FIST = 0.09 // metres from the wrist to the middle of the grip
const IN_HAND = { position: Vector3.create(0, IN_FIST, -0.03), rotation: Quaternion.Identity() }

// build_drink_emote.py SIT_VERSION: the sitting emotes' file names change with them (the explorer caches by name)
const SIT_VERSION = 'v4'

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
  sitEmote: string | null // the same, sitting (on a stool)
  couchEmote: string | null // and on a couch, further back
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
    sitEmote: `assets/emotes/helium3_sit_${SIT_VERSION}_emote.glb`,
    couchEmote: `assets/emotes/helium3_couch_${SIT_VERSION}_emote.glb`,
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
    sitEmote: `assets/emotes/plasma_sit_${SIT_VERSION}_emote.glb`,
    couchEmote: `assets/emotes/plasma_couch_${SIT_VERSION}_emote.glb`,
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
    sitEmote: `assets/emotes/mythic_sit_${SIT_VERSION}_emote.glb`,
    couchEmote: `assets/emotes/mythic_couch_${SIT_VERSION}_emote.glb`,
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
    sitEmote: null,
    couchEmote: null,
    colour: Color3.Black(),
    served: '' // DEX has a whole routine for this one (bartender.ts)
  }
]

const HOLD_SECONDS = 5 * 60 // a drink lasts five minutes (or, if you're drinking then, until you next move)
const STILL_SECONDS = 1.0 // standing (or sitting) still this long starts the drinking emote
const STILL_METRES = 0.03 // moved less than this since the last check: still
const MOVED_METRES = 0.12 // moved this far from where the emote started: it's over (the explorer has stopped it)
const OURS_SECONDS = 2 // an emote command this soon after we triggered ours is ours
const SIT_SETTLE = 0.6 // seconds for the seat's move to land
const NOTICE_SECONDS = 3.5
const DROP_SECONDS = 10 // a shared drop lives this long (to reach everyone), then goes
const GLASS_BREAK = 'assets/audio/glass_break.mp3'
const GLASS_SRC = new Map(DRINKS.filter((d) => d.glass).map((d) => [d.id, d.glass as string]))

/** A dropped drink, shared: every client smashes one where it fell. */
const DrinkDrop = engine.defineComponent('bar::DrinkDrop', {
  drink: Schemas.String,
  by: Schemas.String,
  x: Schemas.Number,
  y: Schemas.Number,
  z: Schemas.Number
})

let holding: Drink | null = null
let anchor: Entity | null = null
let glass: Entity | null = null
let left = 0
let drinkingAt: Vector3 | null = null // where the drinking emote started, while it plays
let triggeredAt = -Infinity
let clock = 0
let sitStartedAt = -1 // when the sit hook sat me down drinking, until the move's landed

/** "You dropped your drink..." while it's showing (menuUi.tsx draws it). */
export const dropNotice = { text: '', left: 0 }

const myAddress = () => (getPlayer()?.userId ?? '').toLowerCase()

/** Hand me a drink (replacing any I'm holding). Shared: everyone docked here sees it in my hand. */
export function holdDrink(drink: Drink): void {
  if (!drink.glass) return
  finishDrink()
  holding = drink
  anchor = engine.addEntity()
  AvatarAttach.create(anchor, { avatarId: myAddress() || undefined, anchorPointId: AvatarAnchorPointType.AAPT_RIGHT_HAND })
  syncEntity(anchor, [AvatarAttach.componentId])
  glass = engine.addEntity()
  Transform.create(glass, { parent: anchor, ...IN_HAND, scale: Vector3.create(GLASS_SCALE, GLASS_SCALE, GLASS_SCALE) })
  GltfContainer.create(glass, { src: drink.glass })
  syncEntity(glass, [Transform.componentId, GltfContainer.componentId])
  parentEntity(glass, anchor)
  left = HOLD_SECONDS
  drinkingAt = null
}

const EMPTY_EMOTE = 'assets/emotes/empty_emote.glb' // a moment standing easy, empty-handed
const EMPTY_SIT_EMOTE = `assets/emotes/empty_sit_${SIT_VERSION}_emote.glb` // sitting on the seat, both hands on the thighs (loops)
const EMPTY_COUCH_EMOTE = `assets/emotes/empty_couch_${SIT_VERSION}_emote.glb`

/** Hand the glass back (to a bartender). Mid-drink, the drinking emote would carry on with its own glass until I
 *  moved, so it's ended with an empty-handed one: standing, a moment and then the explorer's idle; sitting, sat on
 *  the seat as before, hands on the thighs. */
export function handBack(): void {
  const wasDrinking = drinkingAt !== null
  const seated = isSeated()
  finishDrink()
  if (!wasDrinking) return
  triggeredAt = clock
  const couch = seatPlace()?.kind === 'couch'
  void triggerSceneEmote({ src: seated ? (couch ? EMPTY_COUCH_EMOTE : EMPTY_SIT_EMOTE) : EMPTY_EMOTE, loop: seated })
}

/** Where the seat's move actually left me, relative to its seat point (along the way it faces, and up): the sitting
 *  drinking emote's hips are placed for it (tools/build_drink_emote.py SEAT_HIPS, SEAT_BACK). */
function logSeatOffset(at: Vector3): void {
  const seat = seatPlace()
  if (!seat) return
  const f = Vector3.normalize(Vector3.create(seat.lookAt.x - seat.seatPos.x, 0, seat.lookAt.z - seat.seatPos.z))
  const d = Vector3.subtract(at, seat.seatPos)
  console.log(`[drinks] seated: ${(d.x * f.x + d.z * f.z).toFixed(2)} m in front of the seat point, ${d.y.toFixed(2)} m above it`)
}

/** The sitting drinking emote for the seat I'm in (a couch's sits further back). */
const sittingEmote = (d: Drink | null, kind: 'stool' | 'couch' | undefined) => (kind === 'couch' ? d?.couchEmote : d?.sitEmote) ?? null

/** Whether I'm holding a drink. */
export const holdingDrink = (): boolean => holding !== null

/** The drink's gone (finished, dropped, or replaced). */
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

/** Whether a player's drinks are shown here: they're in the scene, and docked at my station. */
function sharedWithMe(address: string): boolean {
  const a = address.toLowerCase()
  if (a === myAddress()) return true
  let present = false
  for (const [, id] of engine.getEntitiesWith(PlayerIdentityData)) {
    if (id.address.toLowerCase() === a) present = true
  }
  return present && getCrew().some((p) => (p.walletAddress ?? '').toLowerCase() === a)
}

/** Drop mine: tell everyone (they smash it their end), smash it here, and say so. */
function dropDrink(): void {
  const drink = holding
  const me = Transform.getOrNull(engine.PlayerEntity)
  finishDrink()
  if (!drink || !me) return
  dropNotice.text = 'You dropped your drink\u2026'
  dropNotice.left = NOTICE_SECONDS
  // Where the hand would be: a little to my right and forward, at about waist height
  const right = Vector3.rotate(Vector3.create(0.25, 0, 0.2), me.rotation)
  const at = Vector3.add(me.position, Vector3.create(right.x, 0.15, right.z))
  const shared = engine.addEntity()
  DrinkDrop.create(shared, { drink: drink.id, by: myAddress(), x: at.x, y: at.y, z: at.z })
  syncEntity(shared, [DrinkDrop.componentId])
  seenDrops.add(shared)
  cleanup.push({ e: shared, at: clock + DROP_SECONDS })
  smash(drink.id, at, me.position.y - 0.85, true)
}

type Piece = { e: Entity; at: number; drink: Drink; floor: Vector3 }
const pieces: Piece[] = []
const cleanup: { e: Entity; at: number }[] = []
const seenDrops = new Set<Entity>()

/** A glass falls from `from` to the floor and shatters, with the crash (heard everywhere if it's mine, nearby if not). */
function smash(drinkId: string, from: Vector3, floorY: number, mine: boolean): void {
  const drink = DRINKS.find((d) => d.id === drinkId)
  const src = GLASS_SRC.get(drinkId)
  if (!drink || !src) return
  const speaker = engine.addEntity()
  Transform.create(speaker, { position: from })
  AudioSource.create(speaker, { audioClipUrl: GLASS_BREAK, playing: true, loop: false, volume: 1, global: mine })
  cleanup.push({ e: speaker, at: clock + 3 })
  const falling = engine.addEntity()
  Transform.create(falling, { position: from, rotation: Quaternion.fromEulerDegrees(-90, 0, 0), scale: Vector3.create(GLASS_SCALE, GLASS_SCALE, GLASS_SCALE) })
  GltfContainer.create(falling, { src })
  Tween.create(falling, {
    mode: Tween.Mode.Move({ start: from, end: Vector3.create(from.x, floorY + 0.02, from.z) }),
    duration: 280,
    easingFunction: EasingFunction.EF_EASEINQUAD
  })
  pieces.push({ e: falling, at: clock, drink, floor: Vector3.create(from.x, floorY, from.z) })
}

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

/** Other people's drinks: hide the glasses of anyone not here with me, and smash the drops of those who are. */
function othersDrinks(): void {
  for (const [e, attach] of engine.getEntitiesWith(AvatarAttach)) {
    if (e === anchor || !attach.avatarId) continue
    const show = sharedWithMe(attach.avatarId)
    for (const [g] of engine.getEntitiesWith(GltfContainer)) {
      if (getParent(g) !== e) continue
      const v = VisibilityComponent.getOrNull(g)
      if (!v || v.visible !== show) VisibilityComponent.createOrReplace(g, { visible: show })
    }
  }
  for (const [e, drop] of engine.getEntitiesWith(DrinkDrop)) {
    if (seenDrops.has(e)) continue
    seenDrops.add(e)
    if (drop.by === myAddress() || !sharedWithMe(drop.by)) continue
    smash(drop.drink, Vector3.create(drop.x, drop.y, drop.z), drop.y - 1.0, false)
  }
}

/** Load every drinking emote's file up front (as hidden models), so none has to be fetched the moment it's played. */
function preloadEmotes(): void {
  const files = [EMPTY_EMOTE, EMPTY_SIT_EMOTE, EMPTY_COUCH_EMOTE, ...DRINKS.flatMap((d) => [d.emote, d.sitEmote, d.couchEmote]).filter((f): f is string => !!f)]
  for (const src of files) {
    const e = engine.addEntity()
    Transform.create(e, { position: Vector3.create(8, -50, 8), scale: Vector3.Zero() })
    GltfContainer.create(e, { src, visibleMeshesCollisionMask: 0, invisibleMeshesCollisionMask: 0 })
  }
}

export function startDrinks(): void {
  preloadEmotes()
  // Sitting down with a drink: the seat's own move, then the sitting drinking emote rather than its sit (the emote's
  // laid out like the sit, so nothing moves in between)
  setSitHook((seatPos, lookAt, kind) => {
    const sitting = sittingEmote(holding, kind)
    if (!sitting) return false
    void movePlayerTo({ newRelativePosition: seatPos, cameraTarget: lookAt })
    triggeredAt = clock
    drinkingAt = null
    sitStartedAt = clock
    void triggerSceneEmote({ src: sitting, loop: true })
    return true
  })
  let lastPos: Vector3 | null = null
  let still = 0
  let lastEmote = -1
  let othersCheck = 0
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
    othersCheck -= dt
    if (othersCheck <= 0) {
      othersCheck = 0.5
      othersDrinks()
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
    const me = Transform.getOrNull(engine.PlayerEntity)
    if (!me) return
    const moved = lastPos ? Vector3.distance(me.position, lastPos) : 0
    lastPos = me.position
    if (drinkingAt && Vector3.distance(me.position, drinkingAt) > MOVED_METRES) drinkingAt = null

    // Finished: once the time's up and I'm not mid-emote (it would carry on with its glass until I moved)
    left -= dt
    if (left <= 0 && !drinkingAt) {
      finishDrink()
      return
    }

    // Still (standing, or sitting in one of the scene's seats): drink. Moving: hold it.
    still = moved < STILL_METRES * Math.max(1, dt * 60) ? still + dt : 0
    const emote = isSeated() ? sittingEmote(holding, seatPlace()?.kind) : holding.emote
    // Just sat down with a drink (the sit hook started the emote as the seat moved me): count it as playing once I'm
    // there, rather than starting it again
    if (sitStartedAt >= 0) {
      if (clock - sitStartedAt > SIT_SETTLE) {
        sitStartedAt = -1
        drinkingAt = me.position
        logSeatOffset(me.position)
      }
      showHandGlass(false)
      return
    }
    if (!drinkingAt && still >= STILL_SECONDS && emote && isSeated()) logSeatOffset(me.position)
    if (!drinkingAt && still >= STILL_SECONDS && emote) {
      drinkingAt = me.position
      triggeredAt = clock
      console.log('[drinks] drinking', emote, isSeated() ? '(seated)' : '(standing)')
      void triggerSceneEmote({ src: emote, loop: true })
    }
    showHandGlass(!drinkingAt)
  })
}
