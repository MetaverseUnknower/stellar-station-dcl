// Stand-in for rebel-radio's descent.ts, for seating.ts (copied from rebel-radio unchanged): rebel-radio hides its
// underground block's entities while the player is on the surface. The station has no hidden block, so
// registering an entity does nothing.
import { Entity } from '@dcl/sdk/ecs'

export function registerBlockEntity(_e: Entity): void {}
