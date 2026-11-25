import { expect } from 'claude-code/testing'
import { GLYPHS, SLOT2, TWO_LOGINS, blob, drawBeneath, fresh, start, test, world } from './flow-harness'
import { keychainItem } from './model'

test('the footer keeps what is drawn beneath it, beside the accounts, and draws each mode label once', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.usage['tok-1'] = [20, 30]
  w.usage['tok-2'] = [10, 30]
  const clock = world(on, w, TWO_LOGINS)
  drawBeneath(on)
  await start($, clock)
  for (const surface of ['terminal', 'desktop'] as const) {
    const footer = await $.ui.mount({ plugin: 'account-rotator', surface, component: 'SessionMode', props: { modes: ['auto mode'] } })
    expect(await footer.find({ type: 'Text', text: /beneath: auto mode/ })).toBeDefined()
    expect(await footer.find(GLYPHS)).toBeDefined()
    expect((await footer.findAll({ type: 'Text', text: /auto mode/ })).length).toBe(1)
    await footer.unmount()
  }
})
