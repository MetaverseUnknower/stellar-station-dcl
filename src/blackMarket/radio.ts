// Pirate radio (a black market slot, server routes/blackMarket.ts): the broadcast on air in this galaxy, scrolled
// across a line of the welcome signs over the pods' system maps (stationMarker.ts). Checked once a minute while
// aboard.
import { engine } from '@dcl/sdk/ecs'
import { getPirateRadio } from '../stationApi'
import { onGateChanged } from '../gate'

const POLL_S = 60
const WIDTH = 34 // characters on show at once
const STEP_S = 0.18 // one character along per step

let tape: string | null = null // the looped text, or null when nothing is on air
let offset = 0

async function check(): Promise<void> {
  try {
    const { broadcast } = await getPirateRadio()
    const next = broadcast ? `PIRATE RADIO ▸ ${broadcast.message}  — ${broadcast.by}     ` : null
    if (next !== tape) offset = 0
    tape = next
  } catch {
    // keep what's showing; try again next time
  }
}

export function startPirateRadio(): void {
  let started = false
  onGateChanged((gate) => {
    if (gate.kind !== 'aboard' || started) return
    started = true
    void check()
    let poll = 0
    let step = 0
    engine.addSystem((dt) => {
      poll += dt
      if (poll >= POLL_S) {
        poll = 0
        void check()
      }
      step += dt
      if (step >= STEP_S) {
        step = 0
        if (tape) offset = (offset + 1) % tape.length
      }
    })
  })
}

/** The line to show now (a window on the scrolling tape), or null when nothing is on air. */
export function radioTicker(): string | null {
  if (!tape) return null
  if (tape.length <= WIDTH) return tape.trim()
  return (tape + tape).slice(offset, offset + WIDTH)
}
