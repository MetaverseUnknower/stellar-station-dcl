// Stand-in for the ship scene's environment.ts, for galaxyMap.ts (copied from the ship): the constants it reads,
// copied unchanged. The ship's environment itself (its interior, skybox, starfield) isn't used here.

// Top of the ship's raised central dais (the galaxy projector stands here).
export const PLATFORM_Y = 40
// The main deck around the dais is 1.09m lower; the station panels stand on it.
export const DECK_Y = PLATFORM_Y - 1.09
// Top of the interior model's central dais: the projector base sits on it. (Dais top is 0.657 in
// model units, and the interior is placed at PLATFORM_Y - 1.33, so 0.657 - 1.33.)
export const DAIS_Y = PLATFORM_Y - 0.673
// Top of galaxy_projector_base.glb as placed below (model height 0.75, z-scaled 0.7, stood upright): the hologram beam starts here.
export const PROJECTOR_TOP_Y = DAIS_Y + 0.75 * 0.7
