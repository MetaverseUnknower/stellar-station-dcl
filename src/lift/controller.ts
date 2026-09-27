// The lifts' dispatching rules, as pure functions (no SDK) so they can be tested on their own. A classic "collective"
// elevator: the car keeps going the way it's going while there are calls that way, stopping for car calls and for
// hall calls in its direction, then turns round. Calls are bitmasks, one bit per floor (floor 0 = bit 1).

export type Calls = { up: number; down: number; car: number }
export type Dir = -1 | 0 | 1

const bit = (floor: number) => 1 << floor
export const has = (mask: number, floor: number) => (mask & bit(floor)) !== 0
export const withCall = (mask: number, floor: number) => mask | bit(floor)
const without = (mask: number, floor: number) => mask & ~bit(floor)

function anyCall(c: Calls, floor: number): boolean {
  return has(c.car, floor) || has(c.up, floor) || has(c.down, floor)
}

function anyBeyond(c: Calls, floor: number, dir: 1 | -1, floors: number): boolean {
  for (let f = floor + dir; f >= 0 && f < floors; f += dir) if (anyCall(c, f)) return true
  return false
}

/**
 * The calls answered by the car stopping at `floor` while travelling `dir`: its car call, and the hall call going the
 * car's way. If nothing is left beyond in that direction the car will turn round, so the other hall call is answered
 * too. Idle (dir 0), both hall calls are.
 */
export function serve(floor: number, dir: Dir, c: Calls, floors: number): Calls {
  let out: Calls = { up: c.up, down: c.down, car: without(c.car, floor) }
  if (dir === 0) return { ...out, up: without(out.up, floor), down: without(out.down, floor) }
  out = dir === 1 ? { ...out, up: without(out.up, floor) } : { ...out, down: without(out.down, floor) }
  if (!anyBeyond(out, floor, dir, floors)) {
    out = dir === 1 ? { ...out, down: without(out.down, floor) } : { ...out, up: without(out.up, floor) }
  }
  return out
}

/** Where the car at `floor` goes next, and which way; null when there's nothing to do. */
export function next(floor: number, dir: Dir, c: Calls, floors: number): { target: number; dir: 1 | -1 } | null {
  const order: (1 | -1)[] = dir === -1 ? [-1, 1] : [1, -1]
  for (const d of order) {
    if (!anyBeyond(c, floor, d, floors)) continue
    // Nearest stop that way: a car call, or a hall call going the same way.
    for (let f = floor + d; f >= 0 && f < floors; f += d) {
      if (has(c.car, f) || has(d === 1 ? c.up : c.down, f)) return { target: f, dir: d }
    }
    // Only calls going the other way lie ahead: go to the farthest, where the car will turn round.
    for (let f = d === 1 ? floors - 1 : 0; f !== floor; f -= d) {
      if (anyCall(c, f)) return { target: f, dir: d }
    }
  }
  return null
}
