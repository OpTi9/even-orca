import type { AgentDotState } from '../../../mobile/src/worktree/agent-row-display'
import {
  findGlanceSession,
  glanceSessionPages,
  type GlanceConnection,
  type GlanceState
} from './glance-controller'
import type { GlanceSession } from './omp-glance-sessions'
import { toGlassesLabel, toGlassesText } from './glance-text'

// Firmware-safe glyphs only; see the G2 font coverage table (even-g2-notes docs/display.md).
const DOT_MARKS: Record<AgentDotState, string> = {
  blocked: '◆',
  waiting: '◆',
  failed: '×',
  working: '●',
  monitoring: '◐',
  done: '○',
  interrupted: '■',
  idle: '·'
}

const RULE = '━━━━━━━━━━━━━━━━━━━━━━━━'

export type GlanceScreen =
  | { kind: 'list'; header: string; items: string[] }
  | { kind: 'text'; body: string }

const CONNECTION_MESSAGES: Record<Exclude<GlanceConnection, 'connected'>, string> = {
  unpaired:
    'Orca is not paired.\n\nOpen this app on your phone and paste the pairing link from Orca Settings > Mobile.',
  connecting: 'Connecting to Orca...',
  offline:
    'Orca is unreachable.\n\nRetrying. Check that Orca is running and the phone is on the same network.',
  'auth-failed': 'Orca refused this pairing.\n\nPair again from Orca Settings > Mobile.'
}

function homeScreen(state: GlanceState): GlanceScreen {
  if (state.connection !== 'connected') {
    return { kind: 'text', body: CONNECTION_MESSAGES[state.connection] }
  }
  const notice = state.notice ? `\n\n${state.notice}` : ''
  if (state.sessions.length === 0) {
    return {
      kind: 'text',
      body: `No oh-my-pi sessions.\n\nStart omp in an Orca workspace and it will appear here.${notice}`
    }
  }
  const attention = state.sessions.filter((s) => s.dot === 'blocked' || s.dot === 'waiting').length
  const summary = attention > 0 ? `${attention} need${attention === 1 ? 's' : ''} you` : 'All quiet'
  return {
    kind: 'list',
    header: toGlassesLabel(`oh-my-pi · ${summary}${state.notice ? ` · ${state.notice}` : ''}`, 90),
    items: state.sessions.map((session) =>
      toGlassesLabel(`${DOT_MARKS[session.dot]} ${session.worktreeLabel}: ${session.headline}`)
    )
  }
}

function sessionHeader(session: GlanceSession): string {
  const wants = session.toolName && (session.dot === 'blocked' || session.dot === 'waiting')
  return toGlassesLabel(
    `${DOT_MARKS[session.dot]} ${session.stateLabel}${wants ? ` · ${session.toolName}` : ''} · ${session.worktreeLabel}`,
    90
  )
}

function sessionScreen(state: GlanceState, session: GlanceSession, page: number): GlanceScreen {
  const pages = glanceSessionPages(session)
  const index = Math.min(page, pages.length - 1)
  const footer = state.notice
    ? toGlassesLabel(state.notice, 90)
    : `${index + 1}/${pages.length} · tap: reply · 2×tap: back`
  return {
    kind: 'text',
    body: `${sessionHeader(session)}\n${RULE}\n${pages[index]}\n${RULE}\n${footer}`
  }
}

function replyScreen(
  session: GlanceSession,
  view: Extract<GlanceState['view'], { kind: 'reply' }>
): GlanceScreen {
  const header = `${sessionHeader(session)}\n${RULE}\n`
  switch (view.phase) {
    case 'listening':
      return {
        kind: 'text',
        body: `${header}● Listening...\n\n${view.heldToTalk ? 'Release to stop.' : 'Tap to stop.'} 2×tap: cancel`
      }
    case 'transcribing':
      return { kind: 'text', body: `${header}Transcribing...` }
    case 'review':
      return {
        kind: 'text',
        body: `${header}"${toGlassesText(view.transcript)}"\n${RULE}\ntap: send · 2×tap: discard`
      }
    case 'sending':
      return { kind: 'text', body: `${header}Sending...` }
  }
}

export function glanceScreen(state: GlanceState): GlanceScreen {
  const { view } = state
  const session = view.kind === 'home' ? null : findGlanceSession(state, view.paneKey)
  if (view.kind === 'home' || !session) {
    return homeScreen(state)
  }
  return view.kind === 'session'
    ? sessionScreen(state, session, view.page)
    : replyScreen(session, view)
}

export function glanceScreensEqual(a: GlanceScreen | null, b: GlanceScreen): boolean {
  if (!a || a.kind !== b.kind) {
    return false
  }
  if (a.kind === 'text' && b.kind === 'text') {
    return a.body === b.body
  }
  return (
    a.kind === 'list' &&
    b.kind === 'list' &&
    a.header === b.header &&
    a.items.length === b.items.length &&
    a.items.every((item, index) => item === b.items[index])
  )
}
