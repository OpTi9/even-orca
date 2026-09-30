import { describe, expect, it } from 'vitest'
import type { RpcResponse } from '../../../mobile/src/transport/types'
import {
  glanceSession,
  LEAF_A,
  LEAF_B,
  NOW,
  wireAgentRow,
  wireWorktree
} from '../glance/glance-test-fixtures'
import { OrcaGlassesClient } from './orca-glasses-client'

type Call = { method: string; params: unknown; options: unknown }

function fakePort(answer: (method: string, params: unknown, callIndex: number) => unknown) {
  const calls: Call[] = []
  return {
    calls,
    sendRequest: async (
      method: string,
      params?: unknown,
      options?: unknown
    ): Promise<RpcResponse> => {
      calls.push({ method, params, options })
      const result = answer(method, params, calls.length - 1)
      if (result instanceof Error) {
        return {
          id: String(calls.length),
          ok: false,
          error: { code: 'x', message: result.message }
        }
      }
      return { id: String(calls.length), ok: true, result }
    }
  }
}

const noWait = async (): Promise<void> => undefined
const session = glanceSession({ paneKey: `tab-1:${LEAF_A}` })
const TERMINALS = {
  terminals: [
    { handle: 'term-other', tabId: 'tab-1', leafId: LEAF_B },
    { handle: 'term-omp', tabId: 'tab-1', leafId: LEAF_A }
  ]
}

describe('readSessions', () => {
  it('reuses the last sessions when the host says nothing changed', async () => {
    const port = fakePort((_method, _params, index) =>
      index === 0
        ? { worktrees: [wireWorktree([wireAgentRow()])], snapshotId: 'snap-1' }
        : { unchanged: true, snapshotId: 'snap-1' }
    )
    const client = new OrcaGlassesClient(port, 'token', noWait)
    const first = await client.readSessions(NOW)
    const second = await client.readSessions(NOW)
    expect(first).toHaveLength(1)
    expect(second).toBe(first)
    expect(port.calls.map((call) => call.params)).toEqual([
      { afterSnapshotId: null },
      { afterSnapshotId: 'snap-1' }
    ])
  })

  it('asks for a fresh snapshot after an unreadable reply', async () => {
    const port = fakePort((_method, _params, index) =>
      index === 0 ? { nope: true } : { worktrees: [], snapshotId: 'snap-9' }
    )
    const client = new OrcaGlassesClient(port, 'token', noWait)
    expect(await client.readSessions(NOW)).toBeNull()
    expect(await client.readSessions(NOW)).toEqual([])
    expect(port.calls[1]?.params).toEqual({ afterSnapshotId: null })
  })
})

describe('sendReply', () => {
  it('pastes behind the sendable guard, then submits separately', async () => {
    const port = fakePort((method) =>
      method === 'terminal.list' ? TERMINALS : { send: { accepted: true } }
    )
    const client = new OrcaGlassesClient(port, 'device-token', noWait)
    expect(await client.sendReply(session, 'run the\nlinter \u001b[201~ too')).toEqual({
      kind: 'sent'
    })
    const client_ = { id: 'device-token', type: 'mobile' }
    expect(port.calls).toEqual([
      {
        method: 'terminal.list',
        params: { worktree: `id:${session.worktreeId}`, includeVisualLayouts: false },
        options: undefined
      },
      {
        method: 'terminal.send',
        params: {
          terminal: 'term-omp',
          text: '\u001b[200~run the linter ␛[201~ too\u001b[201~',
          requireAgentStatus: 'sendable',
          client: client_
        },
        options: { failWhenDisconnected: true }
      },
      {
        method: 'terminal.send',
        params: {
          terminal: 'term-omp',
          enter: true,
          requireAgentStatus: 'sendable',
          client: client_
        },
        options: { failWhenDisconnected: true }
      }
    ])
  })

  it('never submits when the host refuses because an approval is pending', async () => {
    const port = fakePort((method) =>
      method === 'terminal.list'
        ? TERMINALS
        : { send: { accepted: false, refusedReason: 'permission', bytesWritten: 0 } }
    )
    const client = new OrcaGlassesClient(port, 'token', noWait)
    expect(await client.sendReply(session, 'yes')).toEqual({ kind: 'awaiting-approval' })
    expect(port.calls.filter((call) => call.method === 'terminal.send')).toHaveLength(1)
  })

  it('reports a pane whose terminal is gone', async () => {
    const port = fakePort(() => ({ terminals: [] }))
    const client = new OrcaGlassesClient(port, 'token', noWait)
    expect(await client.sendReply(session, 'hi')).toEqual({
      kind: 'failed',
      message: "Couldn't find that session's terminal."
    })
  })

  it('says so when the paste landed but the submit was refused', async () => {
    const port = fakePort((method, params) => {
      if (method === 'terminal.list') {
        return TERMINALS
      }
      const enter = typeof params === 'object' && params !== null && 'enter' in params
      return { send: { accepted: !enter, refusedReason: enter ? 'no-agent' : undefined } }
    })
    const client = new OrcaGlassesClient(port, 'token', noWait)
    expect(await client.sendReply(session, 'hi')).toMatchObject({ kind: 'failed' })
  })
})

describe('dictation', () => {
  it('sends chunks at the host sample rate and returns the transcript', async () => {
    const port = fakePort((method) =>
      method === 'speech.dictation.finish'
        ? { dictationId: 'd1', text: 'ship it' }
        : { dictationId: 'd1' }
    )
    const client = new OrcaGlassesClient(port, 'token', noWait)
    await client.startDictation('d1')
    await client.feedDictation('d1', 'AAAA')
    expect(await client.finishDictation('d1')).toBe('ship it')
    expect(port.calls[1]).toMatchObject({
      method: 'speech.dictation.chunk',
      params: { dictationId: 'd1', audioBase64: 'AAAA', sampleRate: 16_000 }
    })
  })

  it('turns a host refusal into a readable reason', async () => {
    const port = fakePort(() => new Error('voice_dictation_disabled'))
    const client = new OrcaGlassesClient(port, 'token', noWait)
    await expect(client.startDictation('d1')).rejects.toThrow('voice_dictation_disabled')
  })
})
