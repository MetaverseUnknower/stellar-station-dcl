// Friends, from the station: the Crew panel (crewUi.tsx draws it from `crew`). Decentraland players have no other
// way to make friends (the iOS app has its own), and friends are what a private wormhole's guest list is made of.
// Two ways in: swap friend codes, or add someone docked at this station (server routes/friends.ts request-docked).
// The friends list is checked once a minute while aboard, so the CREW button can show waiting requests.
import { engine } from '@dcl/sdk/ecs'
import * as api from '../api'
import {
  getFriends, requestFriendByCode, requestDockedFriend, acceptFriend, rejectFriend,
  type Friend, type FriendRequestIn, type FriendRequestOut
} from '../stationApi'
import { getCrew } from '../audience'
import { onGateChanged } from '../gate'

const POLL_S = 60

export const crew = {
  open: false,
  busy: false,
  message: '',
  warn: false,
  code: '', // the code being typed
  myCode: '',
  myId: '',
  friends: [] as Friend[],
  incoming: [] as FriendRequestIn[],
  outgoing: [] as FriendRequestOut[]
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong.')

async function refresh(): Promise<void> {
  try {
    const f = await getFriends()
    crew.friends = f.friends ?? []
    crew.incoming = f.incomingRequests ?? []
    crew.outgoing = f.outgoingRequests ?? []
  } catch (e) {
    console.log('[crew] friends refresh failed', e)
  }
}

export function startCrew(): void {
  let started = false
  onGateChanged((gate) => {
    if (gate.kind !== 'aboard' || started) return
    started = true
    void api.getPlayerMe().then((me) => {
      crew.myCode = me.friend_code
      crew.myId = me.id
    }).catch(() => {})
    void refresh()
    let timer = 0
    engine.addSystem((dt) => {
      timer += dt
      if (timer < POLL_S) return
      timer = 0
      void refresh()
    })
  })
}

export function toggleCrew(): void {
  crew.open = !crew.open
  if (crew.open) {
    crew.message = ''
    void refresh()
  }
}

async function act(action: () => Promise<unknown>, done: (result: any) => string): Promise<void> {
  if (crew.busy) return
  crew.busy = true
  crew.message = ''
  try {
    const result = await action()
    crew.message = done(result)
    crew.warn = false
    await refresh()
  } catch (e) {
    crew.message = errorText(e)
    crew.warn = true
  } finally {
    crew.busy = false
  }
}

export function addByCode(): void {
  const code = crew.code.trim()
  if (!code) return
  void act(() => requestFriendByCode(code), (r) => {
    crew.code = ''
    return r?.message ?? 'Request sent.'
  })
}

export function addDocked(playerId: string): void {
  void act(() => requestDockedFriend(playerId), (r) => r?.message ?? 'Request sent.')
}

export function accept(req: FriendRequestIn): void {
  void act(() => acceptFriend(req.friendshipId), () => `You and ${req.fromUsername} are now friends.`)
}

export function decline(req: FriendRequestIn): void {
  void act(() => rejectFriend(req.friendshipId), () => 'Request declined.')
}

export type CrewRelation = 'me' | 'friend' | 'asked' | 'asks' | 'none'

/** Where I stand with someone docked here. */
export function relationTo(playerId: string): CrewRelation {
  if (playerId === crew.myId) return 'me'
  if (crew.friends.some((f) => f.playerId === playerId)) return 'friend'
  if (crew.outgoing.some((r) => r.toPlayerId === playerId)) return 'asked'
  if (crew.incoming.some((r) => r.fromPlayerId === playerId)) return 'asks'
  return 'none'
}

/** Crew docked at this station, other than me. */
export const dockedHere = () => getCrew().filter((p) => p.playerId !== crew.myId)
