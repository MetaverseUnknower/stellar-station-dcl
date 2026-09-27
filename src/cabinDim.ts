// Stand-in for the ship scene's cabinDim.ts: the ship dims desk screens with its console camera; the station
// has no console camera, so screens register and nothing happens.
import { Entity } from '@dcl/sdk/ecs'

export function registerDimmableScreen(_screen: Entity, _halfW: number, _halfH: number): void {}
