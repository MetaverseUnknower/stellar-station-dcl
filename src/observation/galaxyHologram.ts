// The galaxy hologram (at balcony 1, the Recreation Deck): the ship's 3D galaxy map, big, turning slowly in the middle of
// the hub's atrium at the balcony's eye level, with the social heat map on (where explorers are in the galaxy). Owners
// of the Eld's wormhole map also see every known wormhole on it (wormholeMap.ts). galaxyMap.ts, heatMap.ts and
// prefs.ts are copied unchanged from the ship scene (environment.ts is a stand-in for its constants).
//
// The ship places its map at its projector, ~1 m above the deck (world 128, 41, 128). Rather than edit that, the map's
// root is parented under two mounts: the outer one stands at the hub's centre, raised to balcony 1, and
// turns; the inner one undoes the ship's (128, _, 128), so the map sits on the turning axis. The map's own code
// keeps writing the transform it always writes.
//
// Preferences are never loaded here, so switching the heat map on (and the map's view) stays in memory and doesn't
// change the player's ship settings on the server (prefs.ts only saves once loaded).
import { engine, Transform, MeshRenderer, Material, MaterialTransparencyMode, TextureWrapMode } from '@dcl/sdk/ecs'
import { Vector3, Quaternion, Color3, Color4 } from '@dcl/sdk/math'
import * as api from '../api'
import { getGalaxyRoot, renderStarSystems, galaxyAnimationSystem, setMapView, clearMap } from '../galaxyMap'
import { setupWormholeMap } from './wormholeMap'
import { setupHeatMap } from '../heatMap'
import { setPref } from '../prefs'
import { onGateChanged } from '../gate'
import { CENTER, FLOOR_Y } from '../station'

const SHIP_MAP_X = 128 // galaxyMap.ts MAP_CENTER (x, z) and its default height
const SHIP_MAP_Z = 128
const SHIP_MAP_Y = 41.2 // heightFor(DEFAULT_HEIGHT_LEVEL): 40.3 + 3 * 0.3
const DECK_1 = 9 // the Recreation Deck (balcony 1), metres above the deck (build_station_models.py BALCONIES[0])
const MAP_ABOVE_DECK = 1.5 // the galaxy's plane, a little above eye level on the Recreation Deck
const MAP_SCALE = 1.6 // the ship's zoom levels (0.2 steps): 1.6 spreads it ~14.4 m, just inside the lift platforms (15.5 m out)
const SPIN = 1 // degrees per second: once round every six minutes
const HUB_PROJECTOR_TOP = 2.2 // the hub projector dais, above the deck

export function buildGalaxyHologram(): void {
  const mapY = FLOOR_Y + DECK_1 + MAP_ABOVE_DECK
  const outer = engine.addEntity()
  Transform.create(outer, { position: Vector3.create(CENTER.x, mapY - SHIP_MAP_Y, CENTER.z) })
  const inner = engine.addEntity()
  Transform.create(inner, { parent: outer, position: Vector3.create(-SHIP_MAP_X, 0, -SHIP_MAP_Z) })

  // A faint beam from the hub projector up to the galaxy (the ship's own beam assumes its projector's height).
  const beam = engine.addEntity()
  const bottom = FLOOR_Y + HUB_PROJECTOR_TOP
  Transform.create(beam, {
    position: Vector3.create(CENTER.x, (bottom + mapY) / 2, CENTER.z),
    scale: Vector3.create(1, mapY - bottom, 1)
  })
  MeshRenderer.setCylinder(beam, 2.4, 6 * 1.5 * MAP_SCALE * 0.9)
  const holo = { src: 'assets/images/hologram-1024.png', wrapMode: TextureWrapMode.TWM_REPEAT }
  Material.setPbrMaterial(beam, {
    texture: Material.Texture.Common(holo),
    emissiveTexture: Material.Texture.Common(holo),
    albedoColor: Color4.create(0.6, 0.85, 1, 0.12),
    emissiveColor: Color3.create(0.35, 0.75, 1),
    emissiveIntensity: 0.8,
    transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND,
    castShadows: false
  })

  engine.addSystem(galaxyAnimationSystem)
  let angle = 0
  engine.addSystem((dt) => {
    angle = (angle + dt * SPIN) % 360
    Transform.getMutable(outer).rotation = Quaternion.fromEulerDegrees(0, angle, 0)
  })

  // The stars, again: when the Eld's wormhole map names one found since they loaded (wormholeMap.ts)
  async function reloadStars(): Promise<void> {
    const me = await api.getPlayerMe()
    const systems = await api.getSystems(me.galaxy_id)
    clearMap()
    Transform.getMutable(getGalaxyRoot()).parent = inner
    renderStarSystems(systems, me.home_system_id, me.current_system_id)
  }
  setupWormholeMap(reloadStars)

  let shown = false
  onGateChanged((gate) => {
    if (gate.kind !== 'aboard' || shown) return
    shown = true
    void (async () => {
      try {
        const me = await api.getPlayerMe()
        const systems = await api.getSystems(me.galaxy_id)
        Transform.getMutable(getGalaxyRoot()).parent = inner
        setMapView({ scale: MAP_SCALE })
        setPref('heatMap', true) // for this session only: the station saves just its own settings (prefs.ts)
        setupHeatMap(me.galaxy_id)
        renderStarSystems(systems, me.home_system_id, me.current_system_id)
      } catch (err) {
        shown = false
        console.log('[galaxy hologram] galaxy map failed', err)
      }
    })()
  })
}
