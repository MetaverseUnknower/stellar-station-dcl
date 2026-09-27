// Stand-in for the ship scene's soundtrack.ts, for sfx.ts (copied from the ship): the station has no
// soundtrack to mute or hold. Track is the ship's type, which the copied api.ts refers to.
export type Track = { id: string; title: string; artist: string | null; url: string; theme: string | null; durationSeconds: number }

export function isMuted(): boolean { return false }
export function holdSoundtrack(_seconds: number): void {}
