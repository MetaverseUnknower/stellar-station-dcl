// Galaxy leaderboards, in two places: the Hall of Records desk on the hub floor (the rankings on top and your
// standing below) and a double-sided board turning above the hub's projector. Both show one category at a time and
// cycle through them; on the desk, picking a category holds it for a while. Server: routes/leaderboards.ts (a
// materialized view refreshed every 10 minutes, ranked within your galaxy).
import { engine, Entity, Transform, TextAlignMode } from '@dcl/sdk/ecs'
import { Color4, Vector3, Quaternion } from '@dcl/sdk/math'
import { getLeaderboards, Leaderboards, LeaderboardCategory } from '../stationApi'
import { createStation, ViewDefinition, StationContext, Screens } from '../stations'
import { Bag, clearBag, text, frame, header, button, fitSize, CYAN, MAGENTA, MAGENTA3, WHITE, DIM, MUTED } from '../stations/draw'
import { showNotification } from '../shipDialogs'
import { onGateChanged } from '../gate'
import { CENTER, FLOOR_Y, hubDesk, HUB_DESK_ANGLES } from '../station'

const REFRESH_SECONDS = 60
const CYCLE_SECONDS = 10
const HOLD_SECONDS = 45 // after picking a category on the desk
const LEFT = TextAlignMode.TAM_MIDDLE_LEFT
const RIGHT = TextAlignMode.TAM_MIDDLE_RIGHT
const GOLD = Color4.create(1, 0.78, 0.25, 1)
const SILVER = Color4.create(0.8, 0.85, 0.95, 1)
const BRONZE = Color4.create(0.85, 0.55, 0.3, 1)

let boards: Leaderboards | null = null
let cycle = 0
const redraws: (() => void)[] = []

function redrawAll(): void {
  for (const r of redraws) r()
}

function ago(iso: string | null): string {
  if (!iso) return ''
  const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
  return min < 1 ? 'UPDATED JUST NOW' : `UPDATED ${min} MIN AGO`
}

/** One category's top 10, in screen coordinates of a 5.6 x 2.8 screen (the desk's top screen). */
function drawCategory(into: Bag, root: Entity, cat: LeaderboardCategory | undefined, title: boolean): void {
  if (title) header(into, root, -2.6, 1.05, { title: 'HALL OF RECORDS', subtitle: 'galaxy leaderboards' })
  if (!cat) {
    text(into, root, 0, -0.1, boards ? 'No rankings yet' : 'Loading the records…', 0.34, MUTED)
    return
  }
  const heading = cat.label.toUpperCase()
  text(into, root, -2.6, 0.68, heading, fitSize(heading, 3.2, 0.3, true), CYAN, LEFT)
  text(into, root, 2.6, 0.68, ago(boards?.refreshedAt ?? null), 0.14, MUTED, RIGHT)
  if (cat.top.length === 0) {
    text(into, root, 0, -0.2, 'Nobody has ranked here yet.\nBe the first!', 0.3, MUTED)
    return
  }
  // Two columns of five.
  cat.top.forEach((e, i) => {
    const x = i < 5 ? -1.4 : 1.4
    const y = 0.38 - (i % 5) * 0.3
    const medal = e.rank === 1 ? GOLD : e.rank === 2 ? SILVER : e.rank === 3 ? BRONZE : DIM
    frame(into, root, x, y, 2.6, 0.26, e.isMe ? { border: MAGENTA3, fill: Color4.create(0.15, 0.02, 0.12, 0.85) } : { fill: Color4.create(0.02, 0.05, 0.12, 0.7) })
    text(into, root, x - 1.2, y, `${e.rank}`, 0.22, medal, LEFT)
    const name = e.isMe ? `${e.username} (you)` : e.username
    text(into, root, x - 0.9, y, name, fitSize(name, 1.6, 0.2), e.isMe ? MAGENTA : WHITE, LEFT)
    text(into, root, x + 1.2, y, `${e.value}`, 0.22, CYAN, RIGHT)
  })
}

function currentCategory(offset: number): LeaderboardCategory | undefined {
  const cats = boards?.categories ?? []
  return cats.length ? cats[(((cycle + offset) % cats.length) + cats.length) % cats.length] : undefined
}

function makeRecordsView(): ViewDefinition {
  const topBag: Bag = []
  const lowBag: Bag = []
  let screens: Screens | null = null
  let picked: number | null = null
  let pickedAt = 0

  const shown = () => (picked !== null ? boards?.categories[picked] : currentCategory(0))

  function drawTop(): void {
    if (!screens) return
    clearBag(topBag)
    const top = screens.top
    drawCategory(topBag, top, shown(), true)
    // Category tabs along the bottom.
    const cats = boards?.categories ?? []
    const active = shown()?.key
    cats.forEach((c, i) => {
      const label = c.label.split(' ')[0].toUpperCase()
      button(topBag, top, -2.3 + i * 0.92, -1.2, 0.86, 0.22, label, c.label, () => {
        picked = i
        pickedAt = Date.now()
        drawTop()
      }, { size: 0.14, variant: c.key === active ? 'primary' : 'outline' })
    })
  }

  function drawLow(): void {
    if (!screens) return
    clearBag(lowBag)
    const low = screens.low
    text(lowBag, low, -2.65, 0.95, 'YOUR STANDING IN THIS GALAXY', 0.22, DIM, LEFT)
    text(lowBag, low, 2.65, 0.95, ago(boards?.refreshedAt ?? null), 0.14, MUTED, RIGHT)
    const cats = boards?.categories ?? []
    cats.forEach((c, i) => {
      const x = i < 3 ? -1.4 : 1.4
      const y = 0.55 - (i % 3) * 0.5
      frame(lowBag, low, x, y, 2.6, 0.42, { fill: Color4.create(0.02, 0.05, 0.12, 0.75) })
      text(lowBag, low, x - 1.2, y + 0.08, c.label.toUpperCase(), fitSize(c.label.toUpperCase(), 1.6, 0.17, true), DIM, LEFT)
      text(lowBag, low, x - 1.2, y - 0.1, c.me ? `${c.me.value}` : '0', 0.24, WHITE, LEFT)
      text(lowBag, low, x + 1.2, y, c.me ? `#${c.me.rank}` : '—', 0.32, c.me && c.me.rank <= 3 ? GOLD : c.me ? CYAN : MUTED, RIGHT)
    })
    text(lowBag, low, 0, -1.0, 'Rankings refresh every 10 minutes. Ties share a rank.', 0.14, MUTED)
  }

  const redraw = () => {
    if (picked !== null && Date.now() - pickedAt > HOLD_SECONDS * 1000) picked = null
    drawTop()
    drawLow()
  }

  return {
    id: 'records',
    async render(s: Screens, _ctx: StationContext): Promise<void> {
      screens = s
      if (!boards) boards = await getLeaderboards()
      if (!redraws.includes(redraw)) redraws.push(redraw)
      redraw()
    },
    clear(): void {
      clearBag(topBag)
      clearBag(lowBag)
      screens = null
    }
  }
}

/** A double-sided board turning slowly above the hub's projector, cycling categories. */
function buildHubBoard(): void {
  const HEIGHT = 7 // above the deck; the projector dais tops out at 2.2 m and the balconies start 20 m out
  const SCALE = 1.6 // a 5.6 x 2.8 screen at 1.6x: about 9 m by 4.5 m
  const pivot = engine.addEntity()
  Transform.create(pivot, { position: Vector3.create(CENTER.x, FLOOR_Y + HEIGHT, CENTER.z), scale: Vector3.create(SCALE, SCALE, SCALE) })
  // Two faces back to back; each draws toward its own -z, so the second is turned half round.
  const faces = [0, 180].map((yaw, i) => {
    const face = engine.addEntity()
    Transform.create(face, { parent: pivot, position: Vector3.create(0, 0, i === 0 ? -0.05 : 0.05), rotation: Quaternion.fromEulerDegrees(0, yaw, 0) })
    return face
  })
  const bags: Bag[] = [[], []]
  const redraw = () => {
    faces.forEach((face, i) => {
      clearBag(bags[i])
      frame(bags[i], face, 0, 0, 5.8, 3.0, { fill: Color4.create(0.02, 0.03, 0.09, 0.85), z: -0.01 })
      // The two faces show neighbouring categories, so walking round shows more of them.
      drawCategory(bags[i], face, currentCategory(i), true)
    })
  }
  redraws.push(redraw)
  redraw()
  let angle = 0
  engine.addSystem((dt) => {
    angle = (angle + dt * 4) % 360 // one turn every 90 s
    Transform.getMutable(pivot).rotation = Quaternion.fromEulerDegrees(0, angle, 0)
  })
}

export function buildHallOfRecords(): void {
  const desk = createStation({
    id: 'records',
    ...hubDesk(HUB_DESK_ANGLES.hallOfRecords),
    views: [makeRecordsView()],
    notify: showNotification
  })
  buildHubBoard()

  const load = async () => {
    try {
      boards = await getLeaderboards()
      redrawAll()
    } catch (err) {
      console.log('[records] leaderboards failed', err)
    }
  }
  let started = false
  onGateChanged((gate) => {
    if (gate.kind !== 'aboard' || started) return
    started = true
    void load().then(() => desk.refresh())
  })

  let refreshTimer = 0
  let cycleTimer = 0
  engine.addSystem((dt) => {
    if (!started) return
    refreshTimer += dt
    cycleTimer += dt
    if (refreshTimer >= REFRESH_SECONDS) {
      refreshTimer = 0
      void load()
    }
    if (cycleTimer >= CYCLE_SECONDS) {
      cycleTimer = 0
      cycle++
      redrawAll()
    }
  })
}
