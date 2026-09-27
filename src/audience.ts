// Requirement 2: everyone sees only the players docked at their own station. The world has one comms room for
// all stations, so this is done locally: one AvatarModifierArea over the whole scene hides every avatar except
// the wallets docked at the viewer's station. Until the list loads, everyone else stays hidden.
import { engine, Transform, AvatarModifierArea, AvatarModifierType } from '@dcl/sdk/ecs'
import { Vector3 } from '@dcl/sdk/math'
import { getPlayer } from '@dcl/sdk/players'
import { getDockedPlayers, DockedPlayer } from './stationApi'
import { getGateState, onGateChanged } from './gate'

const REFRESH_SECONDS = 10

let crew: DockedPlayer[] = []
export function getCrew(): DockedPlayer[] { return crew }

export function startAudienceFilter(): void {
  const area = engine.addEntity()
  // 16 x 16 parcels, from the ground to the scene's height limit (the deck is at y 40).
  Transform.create(area, { position: Vector3.create(128, 80, 128) })
  AvatarModifierArea.create(area, {
    area: Vector3.create(256, 160, 256),
    modifiers: [AvatarModifierType.AMT_HIDE_AVATARS],
    excludeIds: []
  })

  const apply = (wallets: string[]) => {
    const me = getPlayer()?.userId?.toLowerCase()
    const ids = new Set(wallets.map((w) => w.toLowerCase()))
    if (me) ids.add(me)
    const next = [...ids].sort()
    const current = AvatarModifierArea.get(area).excludeIds
    if (next.length === current.length && next.every((id, i) => id === current[i])) return
    AvatarModifierArea.getMutable(area).excludeIds = next
  }

  const refresh = async () => {
    const gate = getGateState()
    if (gate.kind !== 'aboard') {
      crew = []
      apply([])
      return
    }
    try {
      crew = await getDockedPlayers(gate.stationId)
      apply(crew.map((p) => p.walletAddress).filter((w): w is string => !!w))
    } catch (err: any) {
      // Keep the last list on a failed refresh rather than flicker everyone out.
      console.log('[audience] refresh failed', err?.message ?? err)
    }
  }

  apply([])
  onGateChanged(() => void refresh())
  let timer = 0
  engine.addSystem((dt) => {
    timer += dt
    if (timer < REFRESH_SECONDS) return
    timer = 0
    void refresh()
  })
}
