import { z } from 'zod'
import type { RuntimeWorktreeAgentRow } from '../../../src/shared/runtime-types'
import { isAgentStatusState } from '../../../src/shared/agent-status-types'
import { isAgentJournalTurnOutcome } from '../../../src/shared/agent-turn-outcome'
import {
  agentDisplayLabel,
  agentDotState,
  agentStateLabel,
  type AgentDotState
} from '../../../mobile/src/worktree/agent-row-display'
import { GLANCE_LIST_MAX_ITEMS } from './glance-text'

// Checked against `worktree.ps` (RuntimeWorktreePsConditionalResult in
// src/shared/runtime-worktree-contracts.ts). Rows and agents parse one at a time so a malformed
// entry drops alone instead of blanking the list.

export const GLANCE_AGENT_TYPE = 'omp'

export type GlanceSession = {
  paneKey: string
  worktreeId: string
  worktreeLabel: string
  dot: AgentDotState
  stateLabel: string
  headline: string
  /** What the session screen pages through: the last reply, else the prompt. */
  detail: string
  toolName: string | null
  updatedAt: number
}

export type GlanceSnapshot =
  | { kind: 'sessions'; sessions: GlanceSession[]; snapshotId: string | null }
  | { kind: 'unchanged'; snapshotId: string }
  | { kind: 'unreadable' }

const nullableText = z.string().nullable().catch(null)

const mainAgentWireSchema = z.object({
  state: z.string(),
  outcome: z.string().optional(),
  stateStartedAt: z.number()
})

const agentRowWireSchema = z.looseObject({
  paneKey: z.string().min(1),
  parentPaneKey: nullableText,
  state: z.string(),
  workingMode: z.string().optional().catch(undefined),
  agentType: nullableText,
  prompt: z.string().catch(''),
  taskTitle: nullableText,
  displayName: nullableText,
  lastAssistantMessage: nullableText,
  toolName: nullableText,
  toolInput: nullableText,
  interrupted: z.boolean().catch(false),
  mainAgent: mainAgentWireSchema.optional().catch(undefined),
  stateStartedAt: z.number().catch(0),
  updatedAt: z.number().catch(0)
})

const worktreeWireSchema = z.looseObject({
  worktreeId: z.string().min(1),
  displayName: z.string().catch(''),
  branch: z.string().catch(''),
  path: z.string().catch(''),
  agents: z.array(z.unknown()).catch([])
})

const worktreePsWireSchema = z.looseObject({
  worktrees: z.array(z.unknown()).optional(),
  snapshotId: z.string().optional(),
  unchanged: z.boolean().optional()
})

type AgentRowWire = z.output<typeof agentRowWireSchema>

// An arm this build does not know degrades to no row state rather than rejecting the row.
function toHostAgentRow(wire: AgentRowWire): RuntimeWorktreeAgentRow | null {
  if (!isAgentStatusState(wire.state)) {
    return null
  }
  const mainState = wire.mainAgent?.state
  const mainOutcome = wire.mainAgent?.outcome
  return {
    paneKey: wire.paneKey,
    parentPaneKey: wire.parentPaneKey,
    state: wire.state,
    ...(wire.workingMode === 'monitoring' ? { workingMode: 'monitoring' as const } : {}),
    agentType: wire.agentType,
    prompt: wire.prompt,
    taskTitle: wire.taskTitle,
    displayName: wire.displayName,
    lastAssistantMessage: wire.lastAssistantMessage,
    toolName: wire.toolName,
    toolInput: wire.toolInput,
    interrupted: wire.interrupted,
    ...(wire.mainAgent && isAgentStatusState(mainState)
      ? {
          mainAgent: {
            state: mainState,
            ...(isAgentJournalTurnOutcome(mainOutcome) ? { outcome: mainOutcome } : {}),
            stateStartedAt: wire.mainAgent.stateStartedAt
          }
        }
      : {}),
    stateStartedAt: wire.stateStartedAt,
    updatedAt: wire.updatedAt
  }
}

const ATTENTION_ORDER: Record<AgentDotState, number> = {
  blocked: 0,
  waiting: 0,
  failed: 1,
  working: 2,
  monitoring: 2,
  done: 3,
  interrupted: 3,
  idle: 4
}

function worktreeLabel(worktree: z.output<typeof worktreeWireSchema>): string {
  const name = worktree.displayName.trim() || worktree.branch.trim()
  if (name) {
    return name
  }
  const segments = worktree.path.split(/[\\/]/).filter(Boolean)
  return segments.at(-1) ?? worktree.worktreeId
}

function projectSession(
  wire: AgentRowWire,
  worktree: z.output<typeof worktreeWireSchema>,
  now: number
): GlanceSession {
  const row = toHostAgentRow(wire)
  const dot = row ? agentDotState(row, now) : 'idle'
  const detail = (wire.lastAssistantMessage ?? '').trim() || wire.prompt.trim()
  return {
    paneKey: wire.paneKey,
    worktreeId: worktree.worktreeId,
    worktreeLabel: worktreeLabel(worktree),
    dot,
    stateLabel: agentStateLabel(dot),
    headline: row ? agentDisplayLabel(row, now) : detail || agentStateLabel(dot),
    detail,
    toolName: wire.toolName,
    updatedAt: wire.updatedAt
  }
}

/** Top-level oh-my-pi panes across every worktree, attention first, then most recent. */
export function projectOmpGlanceSessions(result: unknown, now: number): GlanceSnapshot {
  const envelope = worktreePsWireSchema.safeParse(result)
  if (!envelope.success) {
    return { kind: 'unreadable' }
  }
  const { worktrees, snapshotId, unchanged } = envelope.data
  if (unchanged === true && snapshotId) {
    return { kind: 'unchanged', snapshotId }
  }
  if (!worktrees) {
    return { kind: 'unreadable' }
  }
  const sessions: GlanceSession[] = []
  for (const rawWorktree of worktrees) {
    const worktree = worktreeWireSchema.safeParse(rawWorktree)
    if (!worktree.success) {
      continue
    }
    for (const rawAgent of worktree.data.agents) {
      const agent = agentRowWireSchema.safeParse(rawAgent)
      // Subagent rows belong to their lead pane, which is the one the glasses can reply to.
      if (
        agent.success &&
        agent.data.parentPaneKey === null &&
        agent.data.agentType?.toLowerCase() === GLANCE_AGENT_TYPE
      ) {
        sessions.push(projectSession(agent.data, worktree.data, now))
      }
    }
  }
  sessions.sort(
    (a, b) => ATTENTION_ORDER[a.dot] - ATTENTION_ORDER[b.dot] || b.updatedAt - a.updatedAt
  )
  return {
    kind: 'sessions',
    sessions: sessions.slice(0, GLANCE_LIST_MAX_ITEMS),
    snapshotId: snapshotId ?? null
  }
}

export function glanceSessionsEqual(
  a: readonly GlanceSession[],
  b: readonly GlanceSession[]
): boolean {
  return (
    a.length === b.length &&
    a.every((session, index) => {
      const other = b[index]
      return (
        other !== undefined &&
        session.paneKey === other.paneKey &&
        session.dot === other.dot &&
        session.headline === other.headline &&
        session.detail === other.detail &&
        session.toolName === other.toolName &&
        session.worktreeLabel === other.worktreeLabel
      )
    })
  )
}
