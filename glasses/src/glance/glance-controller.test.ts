import { describe, expect, it } from 'vitest'
import {
  initialGlanceState,
  reduceGlance,
  type GlanceInput,
  type GlanceState,
  type GlanceStep
} from './glance-controller'
import { glanceSession, LEAF_B } from './glance-test-fixtures'

const session = glanceSession()
const other = glanceSession({ paneKey: `tab-2:${LEAF_B}`, worktreeLabel: 'docs' })

function connectedWith(sessions = [session, other]): GlanceState {
  return { ...initialGlanceState('connected'), sessions }
}

function run(state: GlanceState, ...inputs: GlanceInput[]): GlanceStep {
  let current: GlanceStep = { state, effects: [] }
  for (const input of inputs) {
    const next = reduceGlance(current.state, input)
    current = { state: next.state, effects: [...current.effects, ...next.effects] }
  }
  return current
}

describe('home', () => {
  it('opens the selected session', () => {
    expect(run(connectedWith(), { type: 'select', index: 1 }).state.view).toEqual({
      kind: 'session',
      paneKey: other.paneKey,
      page: 0
    })
  })

  it('asks the host for its exit dialog on a root double-tap', () => {
    expect(run(connectedWith(), { type: 'double-tap' }).effects).toEqual([
      { type: 'show-exit-dialog' }
    ])
  })

  it('ignores a selection past the end', () => {
    expect(run(connectedWith(), { type: 'select', index: 5 }).state.view).toEqual({ kind: 'home' })
  })
})

describe('session', () => {
  const long = glanceSession({ detail: Array.from({ length: 300 }, (_, i) => `w${i}`).join(' ') })

  it('pages within bounds and goes back on double-tap', () => {
    const opened = run(connectedWith([long]), { type: 'select', index: 0 }).state
    const paged = run(opened, { type: 'page-prev' }, { type: 'page-next' }, { type: 'page-next' })
    expect(paged.state.view).toMatchObject({ kind: 'session', page: 2 })
    const clamped = run(
      paged.state,
      ...Array.from({ length: 20 }, () => ({ type: 'page-next' as const }))
    )
    expect(clamped.state.view).toMatchObject({ page: 3 })
    expect(run(clamped.state, { type: 'double-tap' }).state.view).toEqual({ kind: 'home' })
  })

  it('refuses to listen while Orca is offline', () => {
    const opened = run(connectedWith(), { type: 'select', index: 0 }).state
    const offline = run(opened, { type: 'connection', connection: 'offline' }, { type: 'tap' })
    expect(offline.effects).toEqual([])
    expect(offline.state.notice).toBe('Orca is offline.')
  })

  it('follows a vanished pane home', () => {
    const opened = run(connectedWith(), { type: 'select', index: 0 }).state
    const next = run(opened, { type: 'sessions', sessions: [other] }).state
    expect(next.view).toEqual({ kind: 'home' })
    expect(next.notice).toBe('That session ended.')
  })
})

describe('reply', () => {
  const opened = () => run(connectedWith(), { type: 'select', index: 0 }).state

  it('taps through listen, review and send', () => {
    const result = run(
      opened(),
      { type: 'tap' },
      { type: 'tap' },
      { type: 'transcript', text: '  run the linter too  ' },
      { type: 'tap' }
    )
    expect(result.effects).toEqual([
      { type: 'start-dictation' },
      { type: 'finish-dictation' },
      { type: 'send-reply', session, text: 'run the linter too' }
    ])
    expect(result.state.view).toMatchObject({ kind: 'reply', phase: 'sending' })
    const settled = run(result.state, { type: 'reply-settled', outcome: { kind: 'sent' } })
    expect(settled.state.view).toMatchObject({ kind: 'session', paneKey: session.paneKey })
    expect(settled.state.notice).toBe('Sent to oh-my-pi.')
  })

  it('ends a held reply on release but not a tapped one', () => {
    const held = run(opened(), { type: 'hold-start' }, { type: 'hold-end' })
    expect(held.effects).toEqual([{ type: 'start-dictation' }, { type: 'finish-dictation' }])
    const tapped = run(opened(), { type: 'tap' }, { type: 'hold-end' })
    expect(tapped.state.view).toMatchObject({ phase: 'listening' })
  })

  it('finishes when the recording limit is reached', () => {
    const result = run(opened(), { type: 'tap' }, { type: 'listening-limit' })
    expect(result.state.view).toMatchObject({ phase: 'transcribing' })
    expect(result.effects.at(-1)).toEqual({ type: 'finish-dictation' })
  })

  it('cancels listening on double-tap and discards a reviewed reply', () => {
    const cancelled = run(opened(), { type: 'tap' }, { type: 'double-tap' })
    expect(cancelled.effects.at(-1)).toEqual({ type: 'cancel-dictation' })
    expect(cancelled.state.view).toMatchObject({ kind: 'session' })

    const discarded = run(
      opened(),
      { type: 'tap' },
      { type: 'tap' },
      { type: 'transcript', text: 'nope' },
      { type: 'double-tap' }
    )
    expect(discarded.effects.some((effect) => effect.type === 'send-reply')).toBe(false)
    expect(discarded.state.notice).toBe('Reply discarded.')
  })

  it('returns to the session when nothing was heard', () => {
    const result = run(
      opened(),
      { type: 'tap' },
      { type: 'tap' },
      { type: 'transcript', text: ' ' }
    )
    expect(result.state.view).toMatchObject({ kind: 'session' })
    expect(result.state.notice).toBe("Didn't catch that.")
  })

  it('explains a refusal because oh-my-pi is awaiting an approval', () => {
    const sending = run(
      opened(),
      { type: 'tap' },
      { type: 'tap' },
      { type: 'transcript', text: 'yes' },
      { type: 'tap' }
    ).state
    const settled = run(sending, {
      type: 'reply-settled',
      outcome: { kind: 'awaiting-approval' }
    }).state
    expect(settled.notice).toBe('oh-my-pi is waiting on an approval. Answer it in Orca.')
  })

  it('surfaces a dictation failure', () => {
    const result = run(opened(), { type: 'tap' }, { type: 'dictation-failed', message: 'mic off' })
    expect(result.state.view).toMatchObject({ kind: 'session' })
    expect(result.state.notice).toBe('mic off')
  })

  it('closes the microphone when the pane vanishes mid-listen', () => {
    const listening = run(opened(), { type: 'tap' }).state
    const result = run(listening, { type: 'sessions', sessions: [other] })
    expect(result.effects).toEqual([{ type: 'cancel-dictation' }])
    expect(result.state.view).toEqual({ kind: 'home' })
  })

  it('still reports a send that settles after its pane vanished', () => {
    const sending = run(
      opened(),
      { type: 'tap' },
      { type: 'tap' },
      { type: 'transcript', text: 'ship it' },
      { type: 'tap' },
      { type: 'sessions', sessions: [other] }
    ).state
    expect(sending.view).toMatchObject({ kind: 'reply', phase: 'sending' })
    const settled = run(sending, { type: 'reply-settled', outcome: { kind: 'sent' } }).state
    expect(settled.view).toEqual({ kind: 'home' })
    expect(settled.notice).toBe('Sent to oh-my-pi.')
  })
})
