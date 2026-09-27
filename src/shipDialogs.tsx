// The Ship Services desk's HUD dialogs (Recall, Purchase Fuel Cells, Fuel Refinery) and its notification banner,
// lifted unchanged from the ship scene's ui.tsx (which also holds the ship's own HUD, so it can't come over whole).
// stations/shipOverview.ts imports the open*Dialog functions from ../ui, which re-exports them.
import ReactEcs, { UiEntity } from '@dcl/sdk/react-ecs'
import { Color4 } from '@dcl/sdk/math'
import { refreshStation } from './stations'
import { px } from './uiScale'
import { payMana, redeemManaPurchase, paymentErrorMessage } from './payments'
import * as api from './api'

let notification: { text: string; color: Color4; timer: number } | null = null

// Fuel dialogs
let showPurchaseDialog = false

type RecallDialogState = { expeditionId: string; label: string; preview: api.RecallPreview | null; working: boolean; error: string | null }
let recallDialog: RecallDialogState | null = null

const fmtMinutes = (m: number): string => {
  const total = Math.max(1, Math.ceil(m))
  const h = Math.floor(total / 60)
  return h > 0 ? `${h}h ${String(total % 60).padStart(2, '0')}m` : `${total}m`
}
const serverError = (err: any): string => {
  const m = /^API error \d+: (.*)$/s.exec(String(err?.message ?? ''))
  if (m) { try { return JSON.parse(m[1]).error ?? 'Recall failed' } catch { return 'Recall failed' } }
  return err?.message || 'Recall failed'
}

/** Opens the recall confirmation for one expedition and loads its preview. */
export function openRecallDialog(expeditionId: string, label: string): void {
  recallDialog = { expeditionId, label, preview: null, working: false, error: null }
  api.getRecallPreview(expeditionId)
    .then(p => { if (recallDialog?.expeditionId === expeditionId) recallDialog.preview = p })
    .catch(err => { if (recallDialog?.expeditionId === expeditionId) recallDialog.error = serverError(err) })
}

async function confirmRecall(): Promise<void> {
  const d = recallDialog
  if (!d || d.working) return
  d.working = true
  try {
    const r = await api.recallExpedition(d.expeditionId)
    showNotification(`Recall signal sent. The ${d.label.toLowerCase()} pod is back in ${fmtMinutes(r.recallMinutes)}.`, Color4.create(0, 0.9, 1, 1))
    recallDialog = null
    refreshStation('ship')
  } catch (err: any) {
    d.working = false
    d.error = serverError(err)
  }
}

let showRefineryDialog = false
let purchaseStatus: string | null = null
let refineryStatus: string | null = null
let refineryInventory: { helium_3: number; plasma_crystals: number; fuel_cells: number } = { helium_3: 0, plasma_crystals: 0, fuel_cells: 0 }

export function openPurchaseDialog(): void { showPurchaseDialog = true; showRefineryDialog = false; purchaseStatus = null }
export function closePurchaseDialog(): void { showPurchaseDialog = false; purchaseStatus = null }
export function openRefineryDialog(): void {
  showRefineryDialog = true; showPurchaseDialog = false; refineryStatus = null
  loadRefineryInventory()
}
export function closeRefineryDialog(): void { showRefineryDialog = false; refineryStatus = null }

async function loadRefineryInventory(): Promise<void> {
  try {
    const dashboard = await api.getShipDashboard()
    const inv = dashboard.inventory || []
    refineryInventory = { helium_3: 0, plasma_crystals: 0, fuel_cells: dashboard.ship?.fuel_cells ?? 0 }
    for (const item of inv) {
      if (item.resource_type === 'helium_3') refineryInventory.helium_3 = item.quantity
      if (item.resource_type === 'plasma_crystals') refineryInventory.plasma_crystals = item.quantity
    }
  } catch {}
}

async function handleRefine(resourceType: string): Promise<void> {
  refineryStatus = 'Refining...'
  try {
    const result = await api.refineFuel(resourceType, 1)
    refineryStatus = `+${result.fuelGained.toFixed(0)} fuel!`
    await loadRefineryInventory()
    api.invalidateFuelCosts()
    refreshStation('ship')
  } catch (err: any) { refineryStatus = err.message || 'Refine failed' }
}

let purchasing = false
async function handleManaPurchase(tierId: string, manaAmount: number): Promise<void> {
  if (purchasing) return
  purchasing = true
  purchaseStatus = `Confirm sending ${manaAmount} MANA (Polygon) in your wallet…`
  try {
    const txHash = await payMana(manaAmount)
    purchaseStatus = 'Payment sent. Waiting for Polygon to confirm…'
    const result = await redeemManaPurchase(tierId, txHash, attempt => { purchaseStatus = `Waiting for Polygon to confirm… (${attempt * 3}s)` })
    purchaseStatus = `Purchased! Total cells: ${result.fuelCells}`
    api.invalidateFuelCosts()
    refreshStation('ship')
  } catch (err: any) { purchaseStatus = paymentErrorMessage(err, 'Purchase failed') }
  finally { purchasing = false }
}

export function updateNotification(dt: number): void {
  if (notification) { notification.timer -= dt; if (notification.timer <= 0) notification = null }
}
export function showNotification(text: string, color: Color4, duration: number = 5): void {
  notification = { text, color, timer: duration }
}

const NotificationBanner = () => {
  if (!notification) return null
  return (
    <UiEntity uiTransform={{ width: '100%', positionType: 'absolute', position: { top: px(60) }, justifyContent: 'center' }}>
      <UiEntity uiTransform={{ width: px(700), padding: { top: px(16), bottom: px(16), left: px(24), right: px(24) } }} uiBackground={{ color: Color4.create(0.02, 0.02, 0.08, 0.95) }}>
        <UiEntity uiTransform={{ width: '100%', height: px(30) }} uiText={{ value: notification.text, fontSize: px(22), color: notification.color, textAlign: 'middle-center' }} />
      </UiEntity>
    </UiEntity>
  )
}


const RecallDialog = () => {
  const d = recallDialog
  if (!d) return null
  const p = d.preview
  const lines: string[] = d.error ? [d.error]
    : !p ? ['Contacting the pod…']
    : !p.allowed ? [p.reason ?? 'Recall not possible']
    : [
      `Recall: back in ${fmtMinutes(p.recallMinutes)} · ${p.share > 0 ? `~${Math.round(p.share * 100)}% of the haul` : 'returns empty'} · ${Math.round(p.lossChance * 100)}% loss risk`,
      `Or wait: back in ${fmtMinutes(p.waitMinutes)} with the full result`,
    ]
  const canConfirm = !!p && p.allowed && !d.error && !d.working
  return (
    <UiEntity uiTransform={{ width: '100%', height: '100%', positionType: 'absolute', justifyContent: 'center', alignItems: 'center' }}>
      <UiEntity uiTransform={{ width: px(640), flexDirection: 'column', padding: { top: px(20), bottom: px(20), left: px(24), right: px(24) } }} uiBackground={{ color: Color4.create(0.02, 0.02, 0.08, 0.95) }}>
        <UiEntity uiTransform={{ width: '100%', height: px(36), margin: { bottom: px(12) } }} uiText={{ value: `RECALL ${d.label.toUpperCase()} POD?`, fontSize: px(26), color: Color4.create(0, 1, 1, 1), textAlign: 'middle-center' }} />
        {lines.map((line, i) => (
          <UiEntity key={`rl${i}`} uiTransform={{ width: '100%', height: px(28), margin: { bottom: px(6) } }} uiText={{ value: line, fontSize: px(18), color: i === 0 ? Color4.White() : Color4.create(0.6, 0.7, 0.8, 1), textAlign: 'middle-center' }} />
        ))}
        <UiEntity uiTransform={{ width: '100%', flexDirection: 'row', justifyContent: 'center', margin: { top: px(12) } }}>
          <UiEntity uiTransform={{ width: px(200), height: px(44), margin: { right: px(12) }, justifyContent: 'center', alignItems: 'center' }}
            uiBackground={{ color: canConfirm ? Color4.create(0.6, 0.1, 0.5, 1) : Color4.create(0.15, 0.15, 0.15, 1) }}
            uiText={{ value: d.working ? 'SENDING…' : 'RECALL', fontSize: px(20), color: Color4.White(), textAlign: 'middle-center' }}
            onMouseDown={() => { if (canConfirm) void confirmRecall() }} />
          <UiEntity uiTransform={{ width: px(200), height: px(44), justifyContent: 'center', alignItems: 'center' }}
            uiBackground={{ color: Color4.create(0, 0.4, 0.5, 1) }}
            uiText={{ value: 'KEEP WORKING', fontSize: px(20), color: Color4.White(), textAlign: 'middle-center' }}
            onMouseDown={() => { recallDialog = null }} />
        </UiEntity>
      </UiEntity>
    </UiEntity>
  )
}

const PurchaseDialog = () => {
  if (!showPurchaseDialog) return null
  const tiers = [
    { id: 'mana_single', name: 'Quick Top-Up', cells: 1, mana: 10, image: 'assets/images/QuickTopUp.png' },
    { id: 'mana_triple', name: 'Explorer Pack', cells: 3, mana: 20, image: 'assets/images/ExplorerPack.png' },
    { id: 'mana_bulk', name: 'Deep Space Expedition', cells: 10, mana: 50, image: 'assets/images/DeepSpaceExpedition.png' },
  ]
  return (
    <UiEntity uiTransform={{ width: '100%', height: '100%', positionType: 'absolute', justifyContent: 'center', alignItems: 'center' }}>
      <UiEntity uiTransform={{ width: px(700), flexDirection: 'column', padding: { top: px(24), bottom: px(24), left: px(24), right: px(24) } }} uiBackground={{ color: Color4.create(0.02, 0.02, 0.08, 0.95) }}>
        <UiEntity uiTransform={{ width: '100%', flexDirection: 'row', justifyContent: 'space-between', margin: { bottom: px(16) } }}>
          <UiEntity uiTransform={{ height: px(40), flex: 1 }} uiText={{ value: 'PURCHASE FUEL CELLS', fontSize: px(28), color: Color4.create(0, 1, 1, 1), textAlign: 'middle-center' }} />
          <UiEntity
            uiTransform={{ width: px(36), height: px(36), justifyContent: 'center', alignItems: 'center' }}
            uiBackground={{ color: Color4.create(0.3, 0.1, 0.1, 1) }}
            uiText={{ value: 'X', fontSize: px(20), color: Color4.White(), textAlign: 'middle-center' }}
            onMouseDown={() => { closePurchaseDialog() }}
          />
        </UiEntity>
        <UiEntity uiTransform={{ width: '100%', flexDirection: 'row', justifyContent: 'space-between' }}>
          {tiers.map(tier => (
            <UiEntity key={tier.id} uiTransform={{ width: px(200), flexDirection: 'column', alignItems: 'center' }}>
              <UiEntity uiTransform={{ width: px(180), height: px(180), margin: { bottom: px(8) } }} uiBackground={{ texture: { src: tier.image }, textureMode: 'stretch', color: Color4.White() }} />
              <UiEntity uiTransform={{ height: px(24), margin: { bottom: px(4) } }} uiText={{ value: tier.name, fontSize: px(18), color: Color4.White(), textAlign: 'middle-center' }} />
              <UiEntity uiTransform={{ height: px(20), margin: { bottom: px(8) } }} uiText={{ value: `${tier.cells} cell${tier.cells > 1 ? 's' : ''} = ${tier.cells * 50} fuel`, fontSize: px(14), color: Color4.create(0.6, 0.6, 0.6, 1), textAlign: 'middle-center' }} />
              <UiEntity
                uiTransform={{ width: px(160), height: px(44), justifyContent: 'center', alignItems: 'center' }}
                uiBackground={{ color: Color4.create(0, 0.4, 0.5, 1) }}
                uiText={{ value: `${tier.mana} MANA`, fontSize: px(20), color: Color4.White(), textAlign: 'middle-center' }}
                onMouseDown={() => { handleManaPurchase(tier.id, tier.mana) }}
              />
            </UiEntity>
          ))}
        </UiEntity>
        {purchaseStatus ? <UiEntity uiTransform={{ width: '100%', height: px(28), margin: { top: px(12) } }} uiText={{ value: purchaseStatus, fontSize: px(18), color: Color4.create(0.8, 0.8, 0.3, 1), textAlign: 'middle-center' }} /> : null}
      </UiEntity>
    </UiEntity>
  )
}

const RefineryDialog = () => {
  if (!showRefineryDialog) return null
  const resources = [
    { type: 'helium_3', name: 'Helium-3', fuel: 20, quantity: refineryInventory.helium_3, color: Color4.create(0.3, 0.8, 1, 1) },
    { type: 'plasma_crystals', name: 'Plasma Crystals', fuel: 50, quantity: refineryInventory.plasma_crystals, color: Color4.create(0.8, 0.3, 1, 1) },
    { type: 'fuel_cell', name: 'Fuel Cells', fuel: 50, quantity: refineryInventory.fuel_cells, color: Color4.create(0, 1, 0.5, 1) },
  ]
  return (
    <UiEntity uiTransform={{ width: '100%', height: '100%', positionType: 'absolute', justifyContent: 'center', alignItems: 'center' }}>
      <UiEntity uiTransform={{ width: px(500), flexDirection: 'column', padding: { top: px(24), bottom: px(24), left: px(24), right: px(24) } }} uiBackground={{ color: Color4.create(0.02, 0.02, 0.08, 0.95) }}>
        <UiEntity uiTransform={{ width: '100%', flexDirection: 'row', justifyContent: 'space-between', margin: { bottom: px(16) } }}>
          <UiEntity uiTransform={{ height: px(40), flex: 1 }} uiText={{ value: 'FUEL REFINERY', fontSize: px(28), color: Color4.create(0, 1, 1, 1), textAlign: 'middle-center' }} />
          <UiEntity
            uiTransform={{ width: px(36), height: px(36), justifyContent: 'center', alignItems: 'center' }}
            uiBackground={{ color: Color4.create(0.3, 0.1, 0.1, 1) }}
            uiText={{ value: 'X', fontSize: px(20), color: Color4.White(), textAlign: 'middle-center' }}
            onMouseDown={() => { closeRefineryDialog() }}
          />
        </UiEntity>
        {resources.map(res => (
          <UiEntity key={res.type} uiTransform={{ width: '100%', flexDirection: 'row', alignItems: 'center', margin: { bottom: px(12) }, padding: { top: px(10), bottom: px(10), left: px(12), right: px(12) } }} uiBackground={{ color: Color4.create(0.05, 0.08, 0.15, 0.8) }}>
            <UiEntity uiTransform={{ flex: 1, flexDirection: 'column' }}>
              <UiEntity uiTransform={{ height: px(26) }} uiText={{ value: res.name, fontSize: px(22), color: res.color, textAlign: 'middle-left' }} />
              <UiEntity uiTransform={{ height: px(20) }} uiText={{ value: `${res.quantity} available  |  +${res.fuel} fuel each`, fontSize: px(14), color: Color4.create(0.5, 0.5, 0.5, 1), textAlign: 'middle-left' }} />
            </UiEntity>
            <UiEntity
              uiTransform={{ width: px(100), height: px(40), justifyContent: 'center', alignItems: 'center' }}
              uiBackground={{ color: res.quantity > 0 ? Color4.create(0, 0.4, 0.5, 1) : Color4.create(0.15, 0.15, 0.15, 1) }}
              uiText={{ value: 'REFINE', fontSize: px(18), color: res.quantity > 0 ? Color4.White() : Color4.create(0.4, 0.4, 0.4, 1), textAlign: 'middle-center' }}
              onMouseDown={() => { if (res.quantity > 0) handleRefine(res.type) }}
            />
          </UiEntity>
        ))}
        {refineryStatus ? <UiEntity uiTransform={{ width: '100%', height: px(28), margin: { top: px(8) } }} uiText={{ value: refineryStatus, fontSize: px(18), color: Color4.create(0.8, 0.8, 0.3, 1), textAlign: 'middle-center' }} /> : null}
      </UiEntity>
    </UiEntity>
  )
}



/** The ship HUD's pieces this desk needs, rendered by ui.tsx. */
export const ShipDialogs = () => (
  <UiEntity uiTransform={{ width: '100%', height: '100%', positionType: 'absolute' }}>
    <NotificationBanner />
    <PurchaseDialog />
    <RecallDialog />
    <RefineryDialog />
  </UiEntity>
)
