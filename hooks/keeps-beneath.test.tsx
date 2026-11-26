import { expect } from 'claude-code/testing'
import type { On } from 'claude-code'
import { BAND_PROPS, GLYPHS, SLOT2, TWO_LOGINS, blob, fresh, start, test, world } from './flow-harness'
import { keychainItem } from './model'

// Stands for what is drawn beneath the footer, and draws whatever mode labels it is handed.
function drawBeneath(on: On) {
  on('ui.render', { component: 'SessionMode' }, ($$, e) => {
    const { Text } = $$.ui.resolve(e)

    return <Text>beneath: {e.props.modes.join(' & ')}</Text>
  })
}

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
    expect(await footer.find({ type: 'Text', text: /beneath:/ })).toBeDefined()
    expect(await footer.find(GLYPHS)).toBeDefined()
    expect((await footer.findAll({ type: 'Text', text: /auto mode/ })).length).toBe(1)
    await footer.unmount()
  }
})

// Stands for a mod that loads after this one and draws above the prompt, as the lutso mod's running-agent rows do.
// The band's stub names this mod, or it does not answer its next(e) (https://code.claude.com/docs/en/plugins/mods/test.md).
function drawAbovePrompt(on: On) {
  on('ui.render', { component: 'AbovePrompt', plugin: 'account-rotator' }, () => ({
    type: 'Text',
    props: {},
    children: ['later row above the prompt'],
  }))
}

/** A login with nothing in the keychain: the band shows its sign-in. */
async function bandWorld(on: On) {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.usage['tok-1'] = [20, 30]
  return world(on, w, TWO_LOGINS)
}

test('the band keeps what is drawn beneath it, on both surfaces', async ($, on) => {
  const clock = await bandWorld(on)
  await start($, clock)
  for (const surface of ['terminal', 'desktop'] as const) {
    const band = await $.ui.mount({ plugin: 'account-rotator', surface, component: 'AbovePrompt', props: BAND_PROPS })
    expect(await band.find({ text: /two@example.com needs a sign-in/ })).toBeDefined()
    expect(await band.keepsBeneath()).toBe(true)
    await band.unmount()
  }
})

test('a later mod still draws above the prompt while the band shows', async ($, on) => {
  const clock = await bandWorld(on)
  drawAbovePrompt(on)
  await start($, clock)
  const band = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS })
  expect(await band.find({ text: /two@example.com needs a sign-in/ })).toBeDefined()
  expect(await band.find({ type: 'Text', text: 'later row above the prompt' })).toBeDefined()
  await band.unmount()
})

test('with no band to show, what is drawn beneath shows alone', async ($, on) => {
  const w = fresh()
  w.keychain['Claude Code-credentials'] = blob('tok-1')
  w.usage['tok-1'] = [20, 30]
  const clock = world(on, w, { accounts: [TWO_LOGINS.accounts[0]] })
  drawAbovePrompt(on)
  await start($, clock)
  const band = await $.ui.mount({ plugin: 'account-rotator', surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS })
  expect(await band.find({ text: /needs a sign-in/ })).toBeUndefined()
  expect((await band.drawn())?.type).toBe('Text')
  await band.unmount()
})
