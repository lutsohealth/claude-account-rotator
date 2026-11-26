import { expect } from 'claude-code/testing'
import { GLYPHS, SLOT2, TWO_LOGINS, blob, drawBeneath, fresh, start, test, world } from './flow-harness'
import { keychainItem } from './model'

/** Review R2 LOST_LABEL: a later mod may draw a tree of its own, with no mode label in it. */
test('a drawing beneath that omits the modes loses no mode label, on both surfaces', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.keychain[await keychainItem(SLOT2)] = blob('tok-2')
  w.usage['tok-1'] = [20, 30]
  w.usage['tok-2'] = [10, 30]
  const clock = world(on, w, TWO_LOGINS)
  on('ui.render', { component: 'SessionMode' }, ($$, e) => {
    const { Box, Text } = $$.ui.resolve(e)

    return (
      <Box flexDirection="column">
        <Text>later row one</Text>
        <Text>later row two</Text>
      </Box>
    )
  })
  await start($, clock)
  const wrong: string[] = []
  for (const surface of ['terminal', 'desktop'] as const) {
    for (const modes of [['auto mode'], ['plan mode', 'bypass permissions']]) {
      const footer = await $.ui.mount({ plugin: 'account-rotator', surface, component: 'SessionMode', props: { modes } })
      expect(await footer.find({ type: 'Text', text: 'later row two' })).toBeDefined()
      for (const mode of modes) {
        if ((await footer.findAll({ type: 'Text', text: new RegExp(mode) })).length !== 1) wrong.push(`${surface}: ${mode}`)
      }
      await footer.unmount()
    }
  }
  expect(wrong).toEqual([])
})

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
