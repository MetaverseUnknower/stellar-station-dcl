// Hub desks poll and redraw only for someone near enough to read them, one load at a time.
import { it, expect, vi } from 'vitest'
import { engine, Transform } from '@dcl/sdk/ecs'
import { Vector3 } from '@dcl/sdk/math'
import { tick } from './helpers'

let boardCalls = 0
let boardReply: () => Promise<any> = async () => ({ categories: [] })
vi.mock('../src/auth', () => ({ authenticate: vi.fn(async () => ({ hasPlayer: true })), getToken: () => 'token' }))
vi.mock('../src/stationApi', async (orig) => ({
  ...(await orig<any>()),
  getStationStatus: vi.fn(async () => ({ isDocked: true, stationId: 'st1', isAdmin: false })),
  listStations: vi.fn(async () => []),
  getLeaderboards: vi.fn(() => { boardCalls++; return boardReply() }),
}))

import { hubDesk, HUB_DESK_ANGLES, CENTER, FLOOR_Y } from '../src/station'
import { startGate } from '../src/gate'
import { buildHallOfRecords } from '../src/records/hallOfRecords'

const putPlayer = (p: Vector3) => Transform.createOrReplace(engine.PlayerEntity, { position: p })

it('the hall of records polls only while someone is near it, one load at a time', async () => {
  putPlayer(Vector3.create(CENTER.x + 30, FLOOR_Y, CENTER.z))   // far across the hub
  buildHallOfRecords()
  await startGate()                        // aboard: the desk starts
  await tick(1)
  boardCalls = 0
  await tick(300)
  expect(boardCalls).toBe(0)               // was a reload every minute and a rebuild every 10 s, unseen
  boardReply = () => new Promise(() => {}) // a stuck server
  putPlayer(hubDesk(HUB_DESK_ANGLES.hallOfRecords).position)
  await tick(300)
  expect(boardCalls).toBe(1)               // walking up refreshes at once; the stuck load isn't stacked on
}, 20000)
