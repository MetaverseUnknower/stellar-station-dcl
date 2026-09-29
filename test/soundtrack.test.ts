// The soundtrack's volume is written only when the fade changes (outside the lounge it's 1 every frame).
import { it, expect, vi } from 'vitest'
import { AudioStream } from '@dcl/sdk/ecs'

vi.mock('../src/api', async (orig) => ({
  ...(await orig<any>()),
  getSoundtrack: vi.fn(async () => ({ tracks: [{ id: 't1', title: 'One', url: 'https://x/1.mp3', theme: 'theme', durationSeconds: 200 }] })),
}))

import { startSoundtrack, setSoundtrackFade } from '../src/soundtrack'

it("leaves the stream's volume alone while the fade doesn't change", async () => {
  await startSoundtrack()
  setSoundtrackFade(0.5)
  setSoundtrackFade(1)
  const writes = vi.spyOn(AudioStream, 'getMutable')
  for (let i = 0; i < 600; i++) setSoundtrackFade(1)   // ten seconds of frames outside the lounge
  expect(writes).not.toHaveBeenCalled()
  setSoundtrackFade(0.5)
  expect(writes).toHaveBeenCalledTimes(1)
})
