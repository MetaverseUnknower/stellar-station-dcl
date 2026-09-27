// HUD text box for the Notice Board: the world has no text entry, so posts and replies are typed here
// (the same Input pattern as the ship's STEM chat). The desk opens it with openCompose.
import ReactEcs, { UiEntity, Label, Input } from '@dcl/sdk/react-ecs'
import { Color4 } from '@dcl/sdk/math'
import { px } from '../uiScale'

const MAX = 500
const PANEL = Color4.create(0.02, 0.02, 0.08, 0.95)
const CYAN = Color4.create(0, 0.9, 1, 1)
const DIM = Color4.create(0.6, 0.7, 0.8, 1)
const RED = Color4.create(1, 0.4, 0.4, 1)

type Compose = { title: string; placeholder: string; submit: (body: string) => Promise<void> }

let open: Compose | null = null
let draft = ''
let sending = false
let error: string | null = null
let generation = 0 // a new key clears the Input between posts

export function openCompose(title: string, placeholder: string, submit: (body: string) => Promise<void>): void {
  open = { title, placeholder, submit }
  draft = ''
  error = null
  sending = false
  generation++
}

function close(): void {
  open = null
}

async function send(): Promise<void> {
  const c = open
  const body = draft.trim()
  if (!c || sending || body.length === 0 || body.length > MAX) return
  sending = true
  error = null
  try {
    await c.submit(body)
    close()
  } catch (err: any) {
    error = err?.message || 'Could not post'
  }
  sending = false
}

export const ComposePanel = () => {
  if (!open) return null
  const length = draft.trim().length
  const over = length > MAX
  return (
    <UiEntity uiTransform={{ width: '100%', height: '100%', positionType: 'absolute', justifyContent: 'center', alignItems: 'center' }}>
      <UiEntity
        uiTransform={{ width: px(720), flexDirection: 'column', padding: { top: px(20), bottom: px(20), left: px(24), right: px(24) } }}
        uiBackground={{ color: PANEL }}
      >
        <Label value={open.title} fontSize={px(26)} color={CYAN} uiTransform={{ height: px(36), margin: { bottom: px(10) } }} textAlign="middle-left" />
        <Input
          key={`compose-${generation}`}
          uiTransform={{ width: '100%', height: px(96) }}
          uiBackground={{ color: Color4.create(0.05, 0.12, 0.2, 1) }}
          fontSize={px(20)}
          color={Color4.White()}
          placeholder={open.placeholder}
          placeholderColor={DIM}
          value={draft}
          onChange={(v) => { draft = v }}
          onSubmit={(v) => { draft = v; void send() }}
        />
        <UiEntity uiTransform={{ width: '100%', height: px(28), margin: { top: px(6) }, justifyContent: 'space-between', flexDirection: 'row' }}>
          <Label value={error ?? 'Be kind: posts are public to everyone docked here.'} fontSize={px(15)} color={error ? RED : DIM} textAlign="middle-left" />
          <Label value={`${length} / ${MAX}`} fontSize={px(15)} color={over ? RED : DIM} textAlign="middle-right" />
        </UiEntity>
        <UiEntity uiTransform={{ width: '100%', flexDirection: 'row', justifyContent: 'flex-end', margin: { top: px(10) } }}>
          <UiEntity
            uiTransform={{ width: px(160), height: px(44), margin: { right: px(12) }, justifyContent: 'center', alignItems: 'center' }}
            uiBackground={{ color: Color4.create(0.2, 0.2, 0.25, 1) }}
            uiText={{ value: 'CANCEL', fontSize: px(18), color: Color4.White() }}
            onMouseDown={() => close()}
          />
          <UiEntity
            uiTransform={{ width: px(160), height: px(44), justifyContent: 'center', alignItems: 'center' }}
            uiBackground={{ color: length > 0 && !over && !sending ? Color4.create(0, 0.45, 0.55, 1) : Color4.create(0.15, 0.15, 0.15, 1) }}
            uiText={{ value: sending ? 'POSTING…' : 'POST', fontSize: px(18), color: Color4.White() }}
            onMouseDown={() => void send()}
          />
        </UiEntity>
      </UiEntity>
    </UiEntity>
  )
}
