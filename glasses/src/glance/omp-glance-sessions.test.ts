import { describe, expect, it } from 'vitest'
import { projectOmpGlanceSessions, type GlanceSnapshot } from './omp-glance-sessions'
import { LEAF_A, LEAF_B, NOW, wireAgentRow, wireWorktree } from './glance-test-fixtures'

function sessionsOf(snapshot: GlanceSnapshot) {
  if (snapshot.kind !== 'sessions') {
    throw new Error(`expected sessions, got ${snapshot.kind}`)
  }
  return snapshot.sessions
}

describe('projectOmpGlanceSessions', () => {
  it('keeps only top-level oh-my-pi panes', () => {
    const snapshot = projectOmpGlanceSessions(
      {
        worktrees: [
          wireWorktree([
            wireAgentRow(),
            wireAgentRow({ paneKey: `tab-2:${LEAF_B}`, agentType: 'claude' }),
            wireAgentRow({ paneKey: `tab-1:${LEAF_B}`, parentPaneKey: `tab-1:${LEAF_A}` })
          ])
        ],
        snapshotId: 'snap-1'
      },
      NOW
    )
    expect(snapshot).toMatchObject({ kind: 'sessions', snapshotId: 'snap-1' })
    expect(sessionsOf(snapshot).map((session) => session.paneKey)).toEqual([`tab-1:${LEAF_A}`])
  })

  it('puts sessions that need the user first, then the most recent', () => {
    const sessions = sessionsOf(
      projectOmpGlanceSessions(
        {
          worktrees: [
            wireWorktree([wireAgentRow({ paneKey: 'a:1', state: 'done', updatedAt: NOW - 10 })]),
            wireWorktree([wireAgentRow({ paneKey: 'b:1', state: 'working', updatedAt: NOW - 5 })]),
            wireWorktree([
              wireAgentRow({
                paneKey: 'c:1',
                state: 'blocked',
                toolName: 'bash',
                updatedAt: NOW - 50
              })
            ]),
            wireWorktree([wireAgentRow({ paneKey: 'd:1', state: 'done', updatedAt: NOW - 1 })])
          ]
        },
        NOW
      )
    )
    expect(sessions.map((session) => session.paneKey)).toEqual(['c:1', 'b:1', 'd:1', 'a:1'])
    expect(sessions[0]).toMatchObject({ dot: 'blocked', stateLabel: 'Blocked', toolName: 'bash' })
  })

  it('labels a worktree by display name, then branch, then folder', () => {
    const labels = sessionsOf(
      projectOmpGlanceSessions(
        {
          worktrees: [
            wireWorktree([wireAgentRow({ paneKey: 'a:1' })], { displayName: '' }),
            wireWorktree([wireAgentRow({ paneKey: 'b:1', updatedAt: NOW - 2_000 })], {
              displayName: '',
              branch: '',
              path: 'C:\\work\\folder-space'
            })
          ]
        },
        NOW
      )
    ).map((session) => session.worktreeLabel)
    expect(labels).toEqual(['feature/glasses', 'folder-space'])
  })

  it('degrades an unknown state from a newer host instead of dropping the row', () => {
    const [session] = sessionsOf(
      projectOmpGlanceSessions(
        { worktrees: [wireWorktree([wireAgentRow({ state: 'compacting' })])] },
        NOW
      )
    )
    expect(session).toMatchObject({ dot: 'idle', headline: 'Looking at the test runner now.' })
  })

  it('skips malformed rows and agents without blanking the rest', () => {
    const sessions = sessionsOf(
      projectOmpGlanceSessions(
        {
          worktrees: [
            null,
            { agents: [] },
            wireWorktree([{ paneKey: 7 }, wireAgentRow({ lastAssistantMessage: null })])
          ]
        },
        NOW
      )
    )
    expect(sessions).toHaveLength(1)
    expect(sessions[0]?.detail).toBe('fix the flaky test')
  })

  it('decays a stale working row to idle like the desktop', () => {
    const [session] = sessionsOf(
      projectOmpGlanceSessions(
        { worktrees: [wireWorktree([wireAgentRow({ updatedAt: NOW - 31 * 60 * 1000 })])] },
        NOW
      )
    )
    expect(session?.dot).toBe('idle')
  })

  it('reads an unchanged poll and refuses a shape it does not recognise', () => {
    expect(projectOmpGlanceSessions({ unchanged: true, snapshotId: 'snap-2' }, NOW)).toEqual({
      kind: 'unchanged',
      snapshotId: 'snap-2'
    })
    expect(projectOmpGlanceSessions(null, NOW)).toEqual({ kind: 'unreadable' })
    expect(projectOmpGlanceSessions({ totalCount: 0 }, NOW)).toEqual({ kind: 'unreadable' })
  })
})
