// Terra's backdrop shell, as tools/build_terra.py builds it, so the scene can lay things exactly on the views: the
// shell's profile (radius by height), how the views' images run up it (by distance along the wall, to VIEW_TOP),
// and which image and where along it a point round the room shows. Constants here must match build_terra.py.
import { Quaternion } from '@dcl/sdk/math'

// SHELL_POINTS, resampled every 0.5 m to 10 m, as build_terra.py's SHELL.
const POINTS: [number, number][] = [
  [0.0, 8.95], [4.4, 8.95], [5.0, 8.9], [6.0, 8.6], [7.0, 8.1], [8.0, 7.6], [9.0, 6.75], [10.0, 5.6],
  [10.5, 4.6], [10.75, 2.5], [10.8, 0.0]
]
export const VIEW_TOP = 9
const CROP = [0.03, 0.9] // rows of the original images kept, from the top
export const IMAGE_W = 1672 // the originals' size, for placing things by pixel
export const IMAGE_H = 941

function radiusAt(z: number): number {
  for (let i = 0; i < POINTS.length - 1; i++) {
    const [z0, r0] = POINTS[i]
    const [z1, r1] = POINTS[i + 1]
    if (z <= z1) return r0 + ((r1 - r0) * (z - z0)) / (z1 - z0)
  }
  return 0
}

// Distance up the wall to each resampled height, as the views' v runs.
const SAMPLES: { z: number; d: number }[] = []
{
  let d = 0
  let prev: [number, number] | null = null
  for (let z = 0; z <= VIEW_TOP + 1e-6; z += 0.5) {
    const p: [number, number] = [z, radiusAt(z)]
    if (prev) d += Math.hypot(p[0] - prev[0], p[1] - prev[1])
    SAMPLES.push({ z, d })
    prev = p
  }
}
const RUN = SAMPLES[SAMPLES.length - 1].d

/** Height on the wall where the views' texture v (0 at the floor, 1 at VIEW_TOP) lies. */
export function zForV(v: number): number {
  const d = Math.max(0, Math.min(1, v)) * RUN
  for (let i = 0; i < SAMPLES.length - 1; i++) {
    const a = SAMPLES[i]
    const b = SAMPLES[i + 1]
    if (d <= b.d) return a.z + ((b.z - a.z) * (d - a.d)) / (b.d - a.d)
  }
  return VIEW_TOP
}
export function vForZ(z: number): number {
  for (let i = 0; i < SAMPLES.length - 1; i++) {
    const a = SAMPLES[i]
    const b = SAMPLES[i + 1]
    if (z <= b.z) return (a.d + ((b.d - a.d) * (z - a.z)) / (b.z - a.z)) / RUN
  }
  return 1
}

/** Texture v for a pixel row of the original images (the build crops them and fades their top). */
export const vForImageRow = (y: number) => 1 - (y / IMAGE_H - CROP[0]) / (CROP[1] - CROP[0])

/** Which view (0: terra-bg-1, 180 to 0 degrees round the room; 1: terra-bg-2, 360 to 180) and its u, for an angle
 *  round the room (degrees, 0 = away from the door). */
export function viewAt(deg: number): { view: 0 | 1; u: number } {
  const a = ((deg % 360) + 360) % 360
  return a <= 180 ? { view: 0, u: (180 - a) / 180 } : { view: 1, u: (360 - a) / 180 }
}
/** The angle round the room (degrees) where a view's u lies. */
export const angleFor = (view: 0 | 1, u: number) => (view === 0 ? 180 - 180 * u : 360 - 180 * u)

/** A spot on the wall at height z: its distance from the room's centre, `inset` metres in from the shell, and how
 *  far (degrees) the wall leans in from upright there. */
export function onWall(deg: number, z: number, inset: number): { r: number; z: number; tilt: number } {
  const dz = 0.05
  const slope = (radiusAt(z + dz) - radiusAt(z - dz)) / (2 * dz) // dr/dz: negative where the dome leans in
  const tilt = (Math.atan(-slope) * 180) / Math.PI // degrees the wall leans in from vertical
  return { r: radiusAt(z) - inset, z, tilt }
}

/** Orientation for a plane on the wall at scene angle `sceneDeg` (from +X toward +Z), leaning in by `tilt`: planes
 *  read from their -Z side, so +Z points out through the wall, tipped up where the wall leans in. */
export function wallRotation(sceneDeg: number, tilt: number): Quaternion {
  const a = (sceneDeg * Math.PI) / 180
  const yaw = (Math.atan2(Math.cos(a), Math.sin(a)) * 180) / Math.PI // +Z out along (cos a, sin a)
  // Leaning in at the top: the plane's +Z (out) tips up by `tilt`.
  return Quaternion.multiply(Quaternion.fromEulerDegrees(0, yaw, 0), Quaternion.fromEulerDegrees(-tilt, 0, 0))
}

