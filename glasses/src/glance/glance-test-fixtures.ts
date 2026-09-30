import type { GlanceSession } from './omp-glance-sessions'

export const NOW = 1_790_000_000_000

export const LEAF_A = '11111111-1111-4111-8111-111111111111'
export const LEAF_B = '22222222-2222-4222-8222-222222222222'

export function wireAgentRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    paneKey: `tab-1:${LEAF_A}`,
    parentPaneKey: null,
    state: 'working',
    agentType: 'omp',
    prompt: 'fix the flaky test',
    taskTitle: null,
    displayName: null,
    lastAssistantMessage: 'Looking at the test runner now.',
    toolName: null,
    toolInput: null,
    interrupted: false,
    stateStartedAt: NOW - 5_000,
    updatedAt: NOW - 1_000,
    ...overrides
  }
}

export function wireWorktree(
  agents: unknown[],
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    worktreeId: 'repo-1::/work/feature',
    repoId: 'repo-1',
    repo: 'orca',
    path: '/work/feature',
    branch: 'feature/glasses',
    displayName: 'glasses',
    status: 'working',
    agents,
    ...overrides
  }
}

export function glanceSession(overrides: Partial<GlanceSession> = {}): GlanceSession {
  return {
    paneKey: `tab-1:${LEAF_A}`,
    worktreeId: 'repo-1::/work/feature',
    worktreeLabel: 'glasses',
    dot: 'done',
    stateLabel: 'Done',
    headline: 'All tests pass.',
    detail: 'All tests pass.',
    toolName: null,
    updatedAt: NOW,
    ...overrides
  }
}
