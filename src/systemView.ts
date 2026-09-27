// From the ship scene's systemView.ts: the one function stations/sectorMap.ts uses, unchanged.

export function orbitalRadius(slot: number, starType: string | null): number {
  const baseRadius = starType === 'black_hole' ? 3.5 : 1.5
  return baseRadius + (slot - 1) * 1.8
}
