// Stand-in for the ship scene's systemView.ts, for the desk views copied from the ship.
// orbitalRadius (stations/sectorMap.ts) is copied unchanged. selectBody (stations/floraSpecies.ts) clears the
// ship's planet highlight in its system hologram; the station has none, so it does nothing.

export function orbitalRadius(slot: number, starType: string | null): number {
  const baseRadius = starType === 'black_hole' ? 3.5 : 1.5
  return baseRadius + (slot - 1) * 1.8
}

export function selectBody(_body: unknown, _entity?: unknown): void {}
