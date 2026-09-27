// Notice Board wing: this station's bulletin board, on the ship's desk framework (stations.ts), in pod 2.
// Top screen: the posts (pinned first). Low screen: the selected post in full with its replies, and REPLY, DELETE,
// PIN (moderators) and REPORT. Posts and replies are typed in the HUD (compose.tsx). The server keeps the board
// (routes/board.ts): docked players only, 500 characters, 30 days unless pinned, one level of replies.
import { engine, TextAlignMode } from '@dcl/sdk/ecs'
import { Color4, Vector3 } from '@dcl/sdk/math'
import * as board from '../stationApi'
import { Board, BoardPost, BoardReply } from '../stationApi'
import { createStation, ViewDefinition, StationContext, Screens } from '../stations'
import { Bag, clearBag, clickable, text, frame, header, button, fitSize, CYAN, MAGENTA, MAGENTA3, WHITE, DIM, MUTED } from '../stations/draw'
import { showNotification } from '../shipDialogs'
import { onGateChanged } from '../gate'
import { podCenter, podOutward } from '../station'
import { openCompose } from './compose'
import { shortDate } from '../trading/tradeText'

export const NOTICE_BOARD_POD = 2
const FROM_POD_CENTER = 6.5 // like the other wings: the pod's outer side, facing back toward the door
const POLL_SECONDS = 20
const LEFT = TextAlignMode.TAM_MIDDLE_LEFT
const RIGHT = TextAlignMode.TAM_MIDDLE_RIGHT
const AMBER = Color4.create(1, 0.7, 0.2, 1)
const CHAR_W = 0.15 // as in stations/draw.ts (fitSize)
const ROWS = 5
const REPLIES_PER_PAGE = 3

let stationId: string | null = null
let data: Board = { canModerate: false, posts: [] }
let redrawActive: (() => void) | null = null

/** Word-wraps text to lines no wider than `width` at `size`, keeping the author's line breaks. */
function wrap(str: string, width: number, size: number): string[] {
  const max = Math.max(8, Math.floor(width / (CHAR_W * size)))
  const lines: string[] = []
  for (const para of str.split('\n')) {
    let line = ''
    for (let word of para.split(/\s+/).filter(Boolean)) {
      while (word.length > max) {
        if (line) { lines.push(line); line = '' }
        lines.push(word.slice(0, max))
        word = word.slice(max)
      }
      if (!line) line = word
      else if (line.length + 1 + word.length <= max) line += ' ' + word
      else { lines.push(line); line = word }
    }
    lines.push(line)
  }
  return lines
}

function clip(lines: string[], n: number): string[] {
  if (lines.length <= n) return lines
  const out = lines.slice(0, n)
  out[n - 1] = out[n - 1].replace(/.{0,3}$/, '…')
  return out
}

async function load(): Promise<void> {
  if (stationId) data = await board.getBoard(stationId)
}

function makeBoardView(): ViewDefinition {
  const topBag: Bag = []
  const lowBag: Bag = []
  let screens: Screens | null = null
  let ctxRef: StationContext | null = null
  let page = 0
  let replyPage = 0
  let selectedId: string | null = null
  const reported = new Set<string>()

  function drawTop(): void {
    if (!screens || !ctxRef) return
    clearBag(topBag)
    const top = screens.top
    header(topBag, top, -2.6, 1.05, { title: 'NOTICE BOARD', subtitle: 'station bulletins' })
    button(topBag, top, 2.05, 1.05, 1.0, 0.26, '+ NEW POST', 'Write a post', () => newPost(), { variant: 'primary', size: 0.18 })
    const posts = data.posts
    const pages = Math.max(1, Math.ceil(posts.length / ROWS))
    page = Math.min(page, pages - 1)
    if (posts.length === 0) text(topBag, top, 0, -0.1, 'The board is empty.\nPost the first notice!', 0.32, MUTED)
    posts.slice(page * ROWS, page * ROWS + ROWS).forEach((p, i) => {
      const y = 0.6 - i * 0.36
      const sel = p.id === selectedId
      const row = frame(topBag, top, 0, y, 5.3, 0.32, { border: sel ? MAGENTA3 : undefined, fill: Color4.create(sel ? 0.15 : 0.02, 0.03, sel ? 0.12 : 0.1, 0.8) })
      let x = -2.55
      if (p.pinned) {
        text(topBag, top, x, y + 0.07, 'PINNED', 0.15, AMBER, LEFT)
        x += 0.62
      }
      text(topBag, top, x, y + 0.07, p.isMe ? `${p.authorUsername} (you)` : p.authorUsername, 0.19, p.isMe ? MAGENTA : CYAN, LEFT)
      const preview = clip(wrap(p.body, 4.6, 0.17), 1)[0] ?? ''
      text(topBag, top, -2.55, y - 0.08, preview, 0.17, WHITE, LEFT)
      const meta = `${shortDate(p.createdAt)}${p.replies.length ? `  ·  ${p.replies.length} repl${p.replies.length === 1 ? 'y' : 'ies'}` : ''}`
      text(topBag, top, 2.55, y + 0.07, meta, 0.15, MUTED, RIGHT)
      clickable(row, `Read ${p.authorUsername}'s post`, () => { selectedId = p.id; replyPage = 0; drawTop(); drawLow() })
    })
    text(topBag, top, -2.55, -1.22, `${posts.length} POST${posts.length === 1 ? '' : 'S'}  //  EXPIRE AFTER 30 DAYS UNLESS PINNED`, 0.15, MUTED, LEFT)
    if (page > 0) button(topBag, top, 1.2, -1.22, 0.62, 0.2, '‹ PREV', 'Previous page', () => { page--; drawTop() }, { size: 0.15 })
    if (page < pages - 1) button(topBag, top, 1.95, -1.22, 0.62, 0.2, 'NEXT ›', 'Next page', () => { page++; drawTop() }, { size: 0.15 })
  }

  function drawLow(): void {
    if (!screens || !ctxRef) return
    clearBag(lowBag)
    const low = screens.low
    const p = data.posts.find(x => x.id === selectedId)
    if (!p) {
      text(lowBag, low, 0, 0, data.posts.length ? 'Select a post above to read it' : 'Nothing posted yet', 0.34, MUTED)
      return
    }

    // Left: the post and its replies
    frame(lowBag, low, -0.75, 0.05, 3.95, 2.1)
    text(lowBag, low, -2.65, 0.92, `${p.authorUsername}  ·  ${shortDate(p.createdAt)}${p.pinned ? '  ·  PINNED' : ''}`, 0.18, p.isMe ? MAGENTA : CYAN, LEFT)
    const bodyLines = clip(wrap(p.body, 3.8, 0.19), 5)
    bodyLines.forEach((line, i) => text(lowBag, low, -2.65, 0.7 - i * 0.18, line, 0.19, WHITE, LEFT))

    const top = 0.7 - bodyLines.length * 0.18 - 0.12
    text(lowBag, low, -2.65, top, p.replies.length ? `REPLIES (${p.replies.length})` : 'NO REPLIES YET', 0.15, DIM, LEFT)
    const pages = Math.max(1, Math.ceil(p.replies.length / REPLIES_PER_PAGE))
    replyPage = Math.min(replyPage, pages - 1)
    let y = top - 0.2
    for (const r of p.replies.slice(replyPage * REPLIES_PER_PAGE, replyPage * REPLIES_PER_PAGE + REPLIES_PER_PAGE)) {
      if (y < -0.85) break
      text(lowBag, low, -2.55, y, `${r.authorUsername}  ·  ${shortDate(r.createdAt)}`, 0.15, r.isMe ? MAGENTA : CYAN, LEFT)
      replyActions(low, r, y)
      y -= 0.15
      for (const line of clip(wrap(r.body, 3.3, 0.16), 2)) {
        text(lowBag, low, -2.55, y, line, 0.16, WHITE, LEFT)
        y -= 0.15
      }
      y -= 0.06
    }
    if (replyPage > 0) button(lowBag, low, -0.6, -0.98, 0.6, 0.18, '‹ OLDER', 'Earlier replies', () => { replyPage--; drawLow() }, { size: 0.13 })
    if (replyPage < pages - 1) button(lowBag, low, 0.1, -0.98, 0.6, 0.18, 'NEWER ›', 'Later replies', () => { replyPage++; drawLow() }, { size: 0.13 })

    // Right: what you can do with it
    frame(lowBag, low, 2.05, 0.05, 1.35, 2.1)
    let by = 0.72
    const act = (label: string, hover: string, fn: () => void, variant: 'primary' | 'outline' | 'magenta' = 'outline') => {
      button(lowBag, low, 2.05, by, 1.15, 0.28, label, hover, fn, { size: 0.17, variant })
      by -= 0.38
    }
    act('REPLY', 'Reply to this post', () => reply(p), 'primary')
    if (p.isMe || data.canModerate) act('DELETE', 'Delete this post and its replies', () => void remove(p), 'magenta')
    if (data.canModerate) act(p.pinned ? 'UNPIN' : 'PIN', p.pinned ? 'Unpin this post' : 'Pin to the top of the board', () => void pin(p))
    if (!p.isMe) act(reported.has(p.id) ? 'REPORTED' : 'REPORT', 'Report this post to the moderators', () => void report(p))
  }

  /** Small delete / report buttons on a reply's header line. */
  function replyActions(low: Screens['low'], r: BoardReply, y: number): void {
    if (!screens) return
    if (r.isMe || data.canModerate) {
      button(lowBag, low, 1.0, y, 0.2, 0.14, '×', 'Delete this reply', () => void remove(r), { size: 0.12, variant: 'magenta' })
    }
    if (!r.isMe) {
      button(lowBag, low, 0.75, y, 0.2, 0.14, '!', reported.has(r.id) ? 'Reported' : 'Report this reply', () => void report(r), { size: 0.12 })
    }
  }

  function newPost(): void {
    if (!stationId) return
    const id = stationId
    openCompose('NEW NOTICE', 'Write your notice…', async (body) => {
      await board.postToBoard(id, body)
      notify('Posted to the board.', Color4.create(0, 1, 0.5, 1))
      page = 0
      await reload()
    })
  }

  function reply(p: BoardPost): void {
    if (!stationId) return
    const id = stationId
    openCompose(`REPLY TO ${p.authorUsername.toUpperCase()}`, 'Write your reply…', async (body) => {
      await board.postToBoard(id, body, p.id)
      notify('Reply posted.', Color4.create(0, 1, 0.5, 1))
      await reload()
      const updated = data.posts.find(x => x.id === p.id)
      if (updated) replyPage = Math.max(0, Math.ceil(updated.replies.length / REPLIES_PER_PAGE) - 1)
      drawLow()
    })
  }

  async function remove(item: BoardReply): Promise<void> {
    const ctx = ctxRef
    if (!ctx) return
    try {
      await ctx.busy(board.deleteBoardPost(item.id))
      notify('Deleted.', Color4.create(0, 0.9, 1, 1))
      if (item.id === selectedId) selectedId = null
      await reload()
    } catch (err: any) {
      notify(err?.message || 'Could not delete', Color4.create(1, 0.3, 0.3, 1))
    }
  }

  async function pin(p: BoardPost): Promise<void> {
    const ctx = ctxRef
    if (!ctx) return
    try {
      await ctx.busy(board.pinBoardPost(p.id, !p.pinned))
      await reload()
    } catch (err: any) {
      notify(err?.message || 'Could not pin', Color4.create(1, 0.3, 0.3, 1))
    }
  }

  async function report(item: BoardReply): Promise<void> {
    const ctx = ctxRef
    if (!ctx || reported.has(item.id)) return
    try {
      await ctx.busy(board.reportPlayer(item.authorId, 'Notice board post', `station_post ${item.id} at station ${stationId}: ${item.body}`))
      reported.add(item.id)
      notify('Reported. Thanks: a moderator will take a look.', Color4.create(0, 0.9, 1, 1))
      drawLow()
    } catch (err: any) {
      notify(err?.message || 'Could not send the report', Color4.create(1, 0.3, 0.3, 1))
    }
  }

  function notify(msg: string, color: Color4): void {
    ctxRef?.notify(msg, color)
  }

  async function reload(): Promise<void> {
    await load()
    if (selectedId && !data.posts.find(x => x.id === selectedId)) selectedId = null
    drawTop()
    drawLow()
  }

  return {
    id: 'board',
    async render(s: Screens, ctx: StationContext): Promise<void> {
      screens = s
      ctxRef = ctx
      await load()
      if (selectedId && !data.posts.find(x => x.id === selectedId)) selectedId = null
      redrawActive = () => { drawTop(); drawLow() }
      drawTop()
      drawLow()
    },
    clear(): void {
      clearBag(topBag)
      clearBag(lowBag)
      screens = null
    }
  }
}

export function buildNoticeBoard(): void {
  const out = podOutward(NOTICE_BOARD_POD)
  const center = podCenter(NOTICE_BOARD_POD)
  const desk = createStation({
    id: 'board',
    position: Vector3.create(center.x + out.x * FROM_POD_CENTER, center.y, center.z + out.z * FROM_POD_CENTER),
    // A desk's front faces (sin yaw, cos yaw) (see the ship's placements); face back toward the hub.
    yaw: (Math.atan2(-out.x, -out.z) * 180) / Math.PI,
    views: [makeBoardView()],
    notify: showNotification
  })

  onGateChanged((gate) => {
    const next = gate.kind === 'aboard' ? gate.stationId : null
    if (next === stationId) return
    stationId = next
    if (stationId) void desk.refresh()
  })

  // New posts show up while someone's reading.
  let timer = 0
  engine.addSystem((dt) => {
    timer += dt
    if (timer < POLL_SECONDS) return
    timer = 0
    const redraw = redrawActive
    if (!stationId || !redraw) return
    void load().then(() => redraw()).catch(() => {})
  })
}
