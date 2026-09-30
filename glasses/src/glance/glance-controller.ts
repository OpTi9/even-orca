import type { GlanceSession } from './omp-glance-sessions'
import { paginateGlassesText } from './glance-text'

export type GlanceConnection = 'unpaired' | 'connecting' | 'connected' | 'offline' | 'auth-failed'

export type ReplyPhase = 'listening' | 'transcribing' | 'review' | 'sending'

export type GlanceView =
  | { kind: 'home' }
  | { kind: 'session'; paneKey: string; page: number }
  | {
      kind: 'reply'
      paneKey: string
      phase: ReplyPhase
      /** Started by a long press, so its release ends listening. */
      heldToTalk: boolean
      transcript: string
    }

export type GlanceState = {
  connection: GlanceConnection
  sessions: GlanceSession[]
  view: GlanceView
  /** One-shot status line, cleared by the next navigation. */
  notice: string | null
}

export type ReplyOutcome =
  | { kind: 'sent' }
  | { kind: 'awaiting-approval' }
  | { kind: 'not-ready' }
  | { kind: 'failed'; message: string }

export type GlanceInput =
  | { type: 'sessions'; sessions: GlanceSession[] }
  | { type: 'connection'; connection: GlanceConnection }
  | { type: 'select'; index: number }
  | { type: 'tap' }
  | { type: 'double-tap' }
  | { type: 'page-next' }
  | { type: 'page-prev' }
  | { type: 'hold-start' }
  | { type: 'hold-end' }
  | { type: 'listening-limit' }
  | { type: 'transcript'; text: string }
  | { type: 'dictation-failed'; message: string }
  | { type: 'reply-settled'; outcome: ReplyOutcome }

export type GlanceEffect =
  | { type: 'show-exit-dialog' }
  | { type: 'start-dictation' }
  | { type: 'finish-dictation' }
  | { type: 'cancel-dictation' }
  | { type: 'send-reply'; session: GlanceSession; text: string }

export type GlanceStep = { state: GlanceState; effects: GlanceEffect[] }

export function initialGlanceState(connection: GlanceConnection): GlanceState {
  return { connection, sessions: [], view: { kind: 'home' }, notice: null }
}

export function findGlanceSession(state: GlanceState, paneKey: string): GlanceSession | null {
  return state.sessions.find((session) => session.paneKey === paneKey) ?? null
}

export function glanceSessionPages(session: GlanceSession): string[] {
  return paginateGlassesText(session.detail || session.headline)
}

const REPLY_NOTICES: Record<Exclude<ReplyOutcome['kind'], 'failed'>, string> = {
  sent: 'Sent to oh-my-pi.',
  'awaiting-approval': 'oh-my-pi is waiting on an approval. Answer it in Orca.',
  'not-ready': "oh-my-pi isn't at its prompt. Try again when it's done."
}

function replyNotice(outcome: ReplyOutcome): string {
  return outcome.kind === 'failed' ? outcome.message : REPLY_NOTICES[outcome.kind]
}

function step(state: GlanceState, effects: GlanceEffect[] = []): GlanceStep {
  return { state, effects }
}

function toSession(state: GlanceState, paneKey: string, notice: string | null): GlanceStep {
  return step({ ...state, view: { kind: 'session', paneKey, page: 0 }, notice })
}

function startReply(state: GlanceState, paneKey: string, heldToTalk: boolean): GlanceStep {
  if (state.connection !== 'connected') {
    return step({ ...state, notice: 'Orca is offline.' })
  }
  return step(
    {
      ...state,
      view: { kind: 'reply', paneKey, phase: 'listening', heldToTalk, transcript: '' },
      notice: null
    },
    [{ type: 'start-dictation' }]
  )
}

function reduceHome(state: GlanceState, input: GlanceInput): GlanceStep {
  if (input.type === 'select') {
    const session = state.sessions[input.index]
    return session ? toSession(state, session.paneKey, null) : step(state)
  }
  if (input.type === 'double-tap') {
    return step(state, [{ type: 'show-exit-dialog' }])
  }
  return step(state)
}

function reduceSession(
  state: GlanceState,
  view: Extract<GlanceView, { kind: 'session' }>,
  session: GlanceSession,
  input: GlanceInput
): GlanceStep {
  switch (input.type) {
    case 'page-next':
    case 'page-prev': {
      const lastPage = glanceSessionPages(session).length - 1
      const page = Math.min(
        lastPage,
        Math.max(0, view.page + (input.type === 'page-next' ? 1 : -1))
      )
      return page === view.page
        ? step(state)
        : step({ ...state, view: { ...view, page }, notice: null })
    }
    case 'tap':
      return startReply(state, view.paneKey, false)
    case 'hold-start':
      return startReply(state, view.paneKey, true)
    case 'double-tap':
      return step({ ...state, view: { kind: 'home' }, notice: null })
    default:
      return step(state)
  }
}

function reduceReply(
  state: GlanceState,
  view: Extract<GlanceView, { kind: 'reply' }>,
  session: GlanceSession,
  input: GlanceInput
): GlanceStep {
  const withPhase = (phase: ReplyPhase, transcript = view.transcript): GlanceState => ({
    ...state,
    view: { ...view, phase, transcript }
  })
  switch (view.phase) {
    case 'listening':
      if (
        input.type === 'tap' ||
        input.type === 'listening-limit' ||
        (input.type === 'hold-end' && view.heldToTalk)
      ) {
        return step(withPhase('transcribing'), [{ type: 'finish-dictation' }])
      }
      if (input.type === 'double-tap') {
        return step(toSession(state, view.paneKey, null).state, [{ type: 'cancel-dictation' }])
      }
      break
    case 'transcribing':
      if (input.type === 'transcript') {
        const text = input.text.trim()
        return text
          ? step(withPhase('review', text))
          : toSession(state, view.paneKey, "Didn't catch that.")
      }
      if (input.type === 'double-tap') {
        return step(toSession(state, view.paneKey, null).state, [{ type: 'cancel-dictation' }])
      }
      break
    case 'review':
      if (input.type === 'tap') {
        return step(withPhase('sending'), [{ type: 'send-reply', session, text: view.transcript }])
      }
      if (input.type === 'double-tap') {
        return toSession(state, view.paneKey, 'Reply discarded.')
      }
      break
    case 'sending':
      if (input.type === 'reply-settled') {
        return toSession(state, view.paneKey, replyNotice(input.outcome))
      }
      break
  }
  if (
    input.type === 'dictation-failed' &&
    (view.phase === 'listening' || view.phase === 'transcribing')
  ) {
    return toSession(state, view.paneKey, input.message)
  }
  return step(state)
}

export function reduceGlance(state: GlanceState, input: GlanceInput): GlanceStep {
  if (input.type === 'connection') {
    return step({ ...state, connection: input.connection })
  }
  if (input.type === 'sessions') {
    const next = { ...state, sessions: input.sessions }
    const { view } = state
    if (view.kind === 'home' || findGlanceSession(next, view.paneKey)) {
      return step(next)
    }
    // A reply already sent settles on its own; an open microphone must not outlive its pane.
    const effects: GlanceEffect[] =
      view.kind === 'reply' && view.phase === 'listening' ? [{ type: 'cancel-dictation' }] : []
    if (view.kind === 'reply' && view.phase === 'sending') {
      return step(next)
    }
    return step({ ...next, view: { kind: 'home' }, notice: 'That session ended.' }, effects)
  }
  const { view } = state
  if (view.kind === 'home') {
    return reduceHome(state, input)
  }
  const session = findGlanceSession(state, view.paneKey)
  if (!session) {
    const home: GlanceState = { ...state, view: { kind: 'home' } }
    return input.type === 'reply-settled'
      ? step({ ...home, notice: replyNotice(input.outcome) })
      : reduceHome(home, input)
  }
  return view.kind === 'session'
    ? reduceSession(state, view, session, input)
    : reduceReply(state, view, session, input)
}
