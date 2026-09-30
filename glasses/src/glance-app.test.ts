import {
  AudioEvent,
  AudioInputSource,
  List_ItemEvent,
  OsEventTypeList,
  StartUpPageCreateResult,
  Sys_ItemEvent,
  Text_ItemEvent,
  type EvenHubEvent
} from '@evenrealities/even_hub_sdk'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConnectionState, RpcResponse } from '../../mobile/src/transport/types'
import { GlanceApp, type GlanceAppBridge } from './glance-app'
import { LEAF_A, wireAgentRow, wireWorktree } from './glance/glance-test-fixtures'
import { EvenHubPageRenderer, type GlassesPageBridge } from './glasses/even-hub-page-renderer'

type FakeRpcState = {
  calls: { method: string; params: unknown }[]
  onStateChange: ((state: ConnectionState) => void) | null
  closed: number
}

const rpc = vi.hoisted((): FakeRpcState => ({ calls: [], onStateChange: null, closed: 0 }))

vi.mock('../../mobile/src/transport/rpc-client', () => ({
  connect: (
    _endpoint: string,
    _token: string,
    _key: string,
    options: { onStateChange: (state: ConnectionState) => void }
  ) => {
    rpc.onStateChange = options.onStateChange
    return {
      sendRequest: async (method: string, params: unknown): Promise<RpcResponse> => {
        rpc.calls.push({ method, params })
        return { id: '1', ok: true, result: answer(method) }
      },
      close: () => {
        rpc.closed += 1
      }
    }
  }
}))

function answer(method: string): unknown {
  switch (method) {
    case 'worktree.ps':
      return { worktrees: [wireWorktree([wireAgentRow({ state: 'done', updatedAt: Date.now() })])] }
    case 'terminal.list':
      return { terminals: [{ handle: 'term-omp', tabId: 'tab-1', leafId: LEAF_A }] }
    case 'terminal.send':
      return { send: { accepted: true } }
    case 'speech.dictation.finish':
      return { text: 'ship it' }
    default:
      return {}
  }
}

function harness() {
  let listener: ((event: EvenHubEvent) => void) | null = null
  const bridgeCalls: string[] = []
  const bridge: GlanceAppBridge = {
    onEvenHubEvent: (callback) => {
      listener = callback
      return () => undefined
    },
    audioControl: async (open, source) => {
      bridgeCalls.push(`mic:${open}${source ? `:${source}` : ''}`)
      return true
    },
    shutDownPageContainer: async (mode) => {
      bridgeCalls.push(`exit:${mode}`)
      return true
    }
  }
  const pages: string[] = []
  const pageBridge: GlassesPageBridge = {
    createStartUpPageContainer: async () => {
      pages.push('create')
      return StartUpPageCreateResult.success
    },
    rebuildPageContainer: async () => {
      pages.push('rebuild')
      return true
    }
  }
  const app = new GlanceApp(bridge, new EvenHubPageRenderer(pageBridge))
  const emit = (event: EvenHubEvent): void => listener?.(event)
  const text = (eventType?: OsEventTypeList) =>
    emit({ textEvent: new Text_ItemEvent({ eventType }) })
  return { app, bridgeCalls, pages, emit, text }
}

async function connected(h: ReturnType<typeof harness>): Promise<void> {
  h.app.setPairing({ endpoint: 'ws://host:6768', deviceToken: 'token', publicKeyB64: 'key' })
  rpc.onStateChange?.('connected')
  await vi.waitFor(() => expect(h.app.snapshot.sessions).toHaveLength(1))
}

beforeEach(() => {
  rpc.calls.length = 0
  rpc.onStateChange = null
  rpc.closed = 0
})

afterEach(() => {
  vi.useRealTimers()
})

describe('GlanceApp', () => {
  it('shows the host sessions once connected', async () => {
    const h = harness()
    expect(h.app.snapshot.connection).toBe('unpaired')
    await connected(h)
    expect(h.app.snapshot.connection).toBe('connected')
    expect(rpc.calls[0]).toEqual({ method: 'worktree.ps', params: { afterSnapshotId: null } })
  })

  it('streams dictation in order and sends the reviewed reply', async () => {
    const h = harness()
    await connected(h)
    h.emit({ listEvent: new List_ItemEvent({}) })
    h.text()
    await vi.waitFor(() => expect(h.bridgeCalls).toContain(`mic:true:${AudioInputSource.Glasses}`))
    for (let i = 0; i < 30; i += 1) {
      h.emit({ audioEvent: new AudioEvent({ audioPcm: new Uint8Array(320).fill(1) }) })
    }
    await new Promise((resolve) => setTimeout(resolve, 350))
    h.text()
    await vi.waitFor(() => expect(h.app.snapshot.view).toMatchObject({ phase: 'review' }))
    expect(h.bridgeCalls).toContain('mic:false')
    const speech = rpc.calls.filter((call) => call.method.startsWith('speech.'))
    expect(speech.map((call) => call.method)).toEqual([
      'speech.dictation.start',
      'speech.dictation.chunk',
      'speech.dictation.chunk',
      'speech.dictation.finish'
    ])

    await new Promise((resolve) => setTimeout(resolve, 350))
    h.text()
    await vi.waitFor(() => expect(h.app.snapshot.notice).toBe('Sent to oh-my-pi.'))
    const sends = rpc.calls.filter((call) => call.method === 'terminal.send')
    expect(sends).toHaveLength(2)
  })

  it('treats the exit dialog events as inverted until the user answers', async () => {
    const h = harness()
    await connected(h)
    h.text(OsEventTypeList.DOUBLE_CLICK_EVENT)
    expect(h.bridgeCalls).toContain('exit:1')
    const rebuildsBefore = h.pages.length
    h.emit({ sysEvent: new Sys_ItemEvent({ eventType: OsEventTypeList.FOREGROUND_ENTER_EVENT }) })
    await vi.waitFor(() => expect(h.pages.length).toBe(rebuildsBefore + 1))
    // "No" arrives as FOREGROUND_EXIT and must not park the app in background polling.
    await new Promise((resolve) => setTimeout(resolve, 650))
    h.emit({ sysEvent: new Sys_ItemEvent({ eventType: OsEventTypeList.FOREGROUND_EXIT_EVENT }) })
    await vi.waitFor(() => expect(h.pages.length).toBe(rebuildsBefore + 2))
  })

  it('closes the connection when the pairing is forgotten', async () => {
    const h = harness()
    await connected(h)
    h.app.setPairing(null)
    expect(rpc.closed).toBe(1)
    expect(h.app.snapshot).toMatchObject({ connection: 'unpaired', sessions: [] })
  })
})
