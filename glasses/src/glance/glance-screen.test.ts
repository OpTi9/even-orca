import { describe, expect, it } from 'vitest'
import { initialGlanceState, type GlanceState } from './glance-controller'
import { glanceScreen, glanceScreensEqual } from './glance-screen'
import { glanceSession } from './glance-test-fixtures'

const blocked = glanceSession({
  paneKey: 'b:1',
  dot: 'blocked',
  stateLabel: 'Blocked',
  toolName: 'bash',
  headline: 'Run the migration?'
})
const done = glanceSession()

function state(overrides: Partial<GlanceState>): GlanceState {
  return { ...initialGlanceState('connected'), sessions: [blocked, done], ...overrides }
}

describe('glanceScreen', () => {
  it('shows the connection problem instead of a stale list', () => {
    const screen = glanceScreen(state({ connection: 'auth-failed' }))
    expect(screen).toMatchObject({ kind: 'text' })
    expect(screen.kind === 'text' && screen.body).toContain('Pair again')
  })

  it('lists sessions with their mark and counts the ones that need the user', () => {
    expect(glanceScreen(state({}))).toEqual({
      kind: 'list',
      header: 'oh-my-pi · 1 needs you',
      items: ['◆ glasses: Run the migration?', '○ glasses: All tests pass.']
    })
  })

  it('explains an empty host', () => {
    const screen = glanceScreen(state({ sessions: [] }))
    expect(screen.kind === 'text' && screen.body).toContain('No oh-my-pi sessions')
  })

  it('names the tool a blocked session wants and shows the page position', () => {
    const screen = glanceScreen(state({ view: { kind: 'session', paneKey: 'b:1', page: 0 } }))
    expect(screen.kind).toBe('text')
    const body = screen.kind === 'text' ? screen.body : ''
    expect(body.split('\n')[0]).toBe('◆ Blocked · bash · glasses')
    expect(body).toContain('1/1 · tap: reply · 2×tap: back')
  })

  it('shows the transcript for review', () => {
    const screen = glanceScreen(
      state({
        view: {
          kind: 'reply',
          paneKey: done.paneKey,
          phase: 'review',
          heldToTalk: false,
          transcript: 'ship it'
        }
      })
    )
    expect(screen.kind === 'text' && screen.body).toContain('"ship it"')
  })

  it('keeps every body within the firmware text limit', () => {
    const huge = glanceSession({ paneKey: 'h:1', detail: 'x '.repeat(5_000) })
    const screen = glanceScreen(
      state({ sessions: [huge], view: { kind: 'session', paneKey: 'h:1', page: 3 } })
    )
    expect(screen.kind === 'text' && screen.body.length).toBeLessThanOrEqual(1000)
  })
})

describe('glanceScreensEqual', () => {
  it('compares by content so an unchanged poll skips the rebuild', () => {
    expect(glanceScreensEqual(glanceScreen(state({})), glanceScreen(state({})))).toBe(true)
    expect(glanceScreensEqual(null, glanceScreen(state({})))).toBe(false)
    expect(
      glanceScreensEqual(glanceScreen(state({})), glanceScreen(state({ sessions: [done] })))
    ).toBe(false)
  })
})
