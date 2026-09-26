// Stellar Station: the scene players move to while their ship is docked at a Galaxy Gardeners station.
// Placeholder floor only; see HANDOFF.md for what this scene has to do.
import { engine, Transform, MeshRenderer, MeshCollider, Material } from '@dcl/sdk/ecs'
import { Vector3, Color4 } from '@dcl/sdk/math'

export function main() {
  // 16 x 16 parcels = 256 m square, centred on (128, 128)
  const deck = engine.addEntity()
  Transform.create(deck, { position: Vector3.create(128, 0, 128), scale: Vector3.create(256, 0.1, 256) })
  MeshRenderer.setBox(deck)
  MeshCollider.setBox(deck)
  Material.setPbrMaterial(deck, { albedoColor: Color4.create(0.08, 0.1, 0.14, 1), metallic: 0.6, roughness: 0.4 })
}
