import { z } from 'zod'
import type { UnvalidatedRpcRequestPort } from '../../../mobile/src/transport/unvalidated-rpc-request-port'
import type { RpcResponse } from '../../../mobile/src/transport/types'
import { DICTATION_SAMPLE_RATE } from '../../../src/shared/rpc-contract/speech-params'
import {
  BRACKETED_PASTE_END,
  BRACKETED_PASTE_START,
  sanitizeBracketedPasteText
} from '../../../src/shared/terminal-bracketed-paste-text'
import type { ReplyOutcome } from '../glance/glance-controller'
import {
  projectOmpGlanceSessions,
  type GlanceSession,
  type GlanceSnapshot
} from '../glance/omp-glance-sessions'

// Every reply is checked here before it becomes a typed value; unknown keys are ignored so newer
// hosts stay readable (docs/reference/remote-wire-compatibility.md).

const terminalListSchema = z.looseObject({
  terminals: z.array(
    z.looseObject({
      handle: z.string().min(1),
      tabId: z.string().catch(''),
      leafId: z.string().catch('')
    })
  )
})

const terminalSendSchema = z.looseObject({
  send: z.looseObject({
    accepted: z.boolean(),
    refusedReason: z.string().optional().catch(undefined)
  })
})

const dictationFinishSchema = z.looseObject({ text: z.string().catch('') })

/** Matches the desktop POST_PASTE_SUBMIT_DELAY_MS between a guarded paste and its Enter. */
export const SUBMIT_AFTER_PASTE_DELAY_MS = 50

/** Matches mobile DICTATION_FINISH_TIMEOUT_MS: a local model may transcribe slowly. */
const DICTATION_FINISH_TIMEOUT_MS = 75_000

// Keystroke sends must never replay after a reconnect (mobile TERMINAL_INPUT_SEND_OPTIONS).
const INPUT_SEND_OPTIONS = { failWhenDisconnected: true }

export class OrcaRequestError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message)
    this.name = 'OrcaRequestError'
  }
}

function resultOf(response: RpcResponse): unknown {
  if (!response.ok) {
    throw new OrcaRequestError(response.error.code, response.error.message)
  }
  return response.result
}

const DICTATION_ERRORS: readonly [string, string][] = [
  ['voice_dictation_disabled', 'Voice dictation is off. Turn it on in Orca voice settings.'],
  ['voice_model_not_selected', 'Pick a dictation model in Orca voice settings.'],
  ['voice_model_not_ready', "Orca's dictation model isn't downloaded yet."],
  ['dictation_already_active', 'Orca is already dictating for another device.']
]

export function describeOrcaError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  const known = DICTATION_ERRORS.find(([code]) => message.includes(code))
  return known ? known[1] : `Orca: ${message}`
}

export class OrcaGlassesClient {
  private snapshotId: string | null = null
  private lastSessions: GlanceSession[] = []

  constructor(
    private readonly rpc: UnvalidatedRpcRequestPort,
    private readonly deviceToken: string,
    private readonly wait: (ms: number) => Promise<void> = (ms) =>
      new Promise((resolve) => setTimeout(resolve, ms))
  ) {}

  /** Null when the host answered with something unreadable; the caller keeps what it shows. */
  async readSessions(now: number): Promise<GlanceSession[] | null> {
    const response = await this.rpc.sendRequest('worktree.ps', {
      afterSnapshotId: this.snapshotId
    })
    const snapshot: GlanceSnapshot = projectOmpGlanceSessions(resultOf(response), now)
    if (snapshot.kind === 'unreadable') {
      this.snapshotId = null
      return null
    }
    this.snapshotId = snapshot.snapshotId
    if (snapshot.kind === 'sessions') {
      this.lastSessions = snapshot.sessions
    }
    return this.lastSessions
  }

  /** Types the reply only while oh-my-pi sits at its prompt: the host refuses a guarded send to a
   *  pane awaiting a permission, so speech can never land in an approval selector. */
  async sendReply(session: GlanceSession, text: string): Promise<ReplyOutcome> {
    try {
      const terminal = await this.resolveTerminal(session)
      if (!terminal) {
        return { kind: 'failed', message: "Couldn't find that session's terminal." }
      }
      const client = { id: this.deviceToken, type: 'mobile' as const }
      const spoken = text.replace(/\s*[\r\n]+\s*/g, ' ').trim()
      const paste = await this.send({
        terminal,
        text: `${BRACKETED_PASTE_START}${sanitizeBracketedPasteText(spoken)}${BRACKETED_PASTE_END}`,
        requireAgentStatus: 'sendable',
        client
      })
      if (!paste.accepted) {
        return paste.refusedReason === 'permission'
          ? { kind: 'awaiting-approval' }
          : { kind: 'not-ready' }
      }
      await this.wait(SUBMIT_AFTER_PASTE_DELAY_MS)
      const submit = await this.send({
        terminal,
        enter: true,
        requireAgentStatus: 'sendable',
        client
      })
      return submit.accepted
        ? { kind: 'sent' }
        : { kind: 'failed', message: 'Reply typed but not submitted. Press Enter in Orca.' }
    } catch (error) {
      return { kind: 'failed', message: describeOrcaError(error) }
    }
  }

  async startDictation(dictationId: string): Promise<void> {
    resultOf(await this.rpc.sendRequest('speech.dictation.start', { dictationId }))
  }

  async feedDictation(dictationId: string, audioBase64: string): Promise<void> {
    resultOf(
      await this.rpc.sendRequest(
        'speech.dictation.chunk',
        { dictationId, audioBase64, sampleRate: DICTATION_SAMPLE_RATE },
        INPUT_SEND_OPTIONS
      )
    )
  }

  async finishDictation(dictationId: string): Promise<string> {
    const response = await this.rpc.sendRequest(
      'speech.dictation.finish',
      { dictationId },
      { timeoutMs: DICTATION_FINISH_TIMEOUT_MS }
    )
    return dictationFinishSchema.parse(resultOf(response)).text
  }

  async cancelDictation(dictationId: string): Promise<void> {
    resultOf(await this.rpc.sendRequest('speech.dictation.cancel', { dictationId }))
  }

  // paneKey is `${tabId}:${leafId}` (src/shared/stable-pane-id.ts).
  private async resolveTerminal(session: GlanceSession): Promise<string | null> {
    const response = await this.rpc.sendRequest('terminal.list', {
      worktree: `id:${session.worktreeId}`,
      includeVisualLayouts: false
    })
    const { terminals } = terminalListSchema.parse(resultOf(response))
    const match = terminals.find(
      (terminal) => `${terminal.tabId}:${terminal.leafId}` === session.paneKey
    )
    return match?.handle ?? null
  }

  private async send(params: Record<string, unknown>) {
    const response = await this.rpc.sendRequest('terminal.send', params, INPUT_SEND_OPTIONS)
    return terminalSendSchema.parse(resultOf(response)).send
  }
}
