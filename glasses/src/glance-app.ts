import {
  AudioInputSource,
  type EvenAppBridge,
  type EvenHubEvent
} from '@evenrealities/even_hub_sdk'
import { connect, type RpcClient } from '../../mobile/src/transport/rpc-client'
import type { ConnectionState } from '../../mobile/src/transport/types'
import {
  createDictationAudioChunker,
  type DictationAudioChunker
} from './audio/dictation-audio-chunker'
import {
  initialGlanceState,
  reduceGlance,
  type GlanceConnection,
  type GlanceEffect,
  type GlanceInput,
  type GlanceState
} from './glance/glance-controller'
import { glanceScreen } from './glance/glance-screen'
import { glanceSessionsEqual } from './glance/omp-glance-sessions'
import {
  createGlassesSignalGate,
  readGlassesSignal,
  type GlassesLifecycle
} from './glasses/even-hub-input'
import type { EvenHubPageRenderer } from './glasses/even-hub-page-renderer'
import { describeOrcaError, OrcaGlassesClient } from './orca/orca-glasses-client'
import type { OrcaGlassesPairing } from './orca/orca-glasses-pairing'

const FOREGROUND_POLL_MS = 3_000
const BACKGROUND_POLL_MS = 15_000

type ActiveDictation = {
  id: string
  chunker: DictationAudioChunker
  /** Start, then every chunk, strictly in order; a chunk before start is refused by the host. */
  chain: Promise<void>
  failed: boolean
}

function toGlanceConnection(state: ConnectionState): GlanceConnection {
  switch (state) {
    case 'connected':
      return 'connected'
    case 'auth-failed':
      return 'auth-failed'
    case 'disconnected':
      return 'offline'
    default:
      return 'connecting'
  }
}

export type GlanceAppListener = (state: GlanceState) => void

export type GlanceAppBridge = Pick<
  EvenAppBridge,
  'onEvenHubEvent' | 'audioControl' | 'shutDownPageContainer'
>

/** Owns one pairing's connection and drives the glasses from the reducer's effects. */
export class GlanceApp {
  private state = initialGlanceState('unpaired')
  private rpc: RpcClient | null = null
  private client: OrcaGlassesClient | null = null
  private pollTimer: ReturnType<typeof setTimeout> | null = null
  private polling = false
  private background = false
  private exitDialogOpen = false
  private dictation: ActiveDictation | null = null
  private readonly gate = createGlassesSignalGate()
  private readonly listeners = new Set<GlanceAppListener>()
  private readonly unsubscribeEvents: () => void

  constructor(
    private readonly bridge: GlanceAppBridge,
    private readonly renderer: EvenHubPageRenderer
  ) {
    this.unsubscribeEvents = bridge.onEvenHubEvent((event) => this.onEvenHubEvent(event))
    void this.renderer.render(glanceScreen(this.state))
  }

  get snapshot(): GlanceState {
    return this.state
  }

  subscribe(listener: GlanceAppListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Replaces any current pairing; null returns the glasses to the "not paired" screen. */
  setPairing(pairing: OrcaGlassesPairing | null): void {
    this.disconnect()
    if (!pairing) {
      this.dispatch({ type: 'connection', connection: 'unpaired' })
      return
    }
    this.dispatch({ type: 'connection', connection: 'connecting' })
    const rpc = connect(pairing.endpoint, pairing.deviceToken, pairing.publicKeyB64, {
      onStateChange: (state) => {
        if (this.rpc !== rpc) {
          return
        }
        this.dispatch({ type: 'connection', connection: toGlanceConnection(state) })
        if (state === 'connected') {
          this.schedulePoll(0)
        }
      }
    })
    this.rpc = rpc
    this.client = new OrcaGlassesClient(rpc, pairing.deviceToken)
  }

  dispose(): void {
    this.disconnect()
    this.unsubscribeEvents()
    this.listeners.clear()
  }

  private disconnect(): void {
    this.cancelDictation()
    if (this.pollTimer) {
      clearTimeout(this.pollTimer)
      this.pollTimer = null
    }
    this.rpc?.close()
    this.rpc = null
    this.client = null
    this.dispatch({ type: 'sessions', sessions: [] })
  }

  private dispatch(input: GlanceInput): void {
    const { state, effects } = reduceGlance(this.state, input)
    this.state = state
    for (const effect of effects) {
      this.runEffect(effect)
    }
    // Why: an effect may dispatch synchronously; render whatever state is now current.
    if (this.state === state) {
      void this.renderer.render(glanceScreen(state))
      for (const listener of this.listeners) {
        listener(state)
      }
    }
  }

  private runEffect(effect: GlanceEffect): void {
    switch (effect.type) {
      case 'show-exit-dialog':
        this.exitDialogOpen = true
        void this.bridge.shutDownPageContainer(1)
        return
      case 'start-dictation':
        this.startDictation()
        return
      case 'finish-dictation':
        this.finishDictation()
        return
      case 'cancel-dictation':
        this.cancelDictation()
        return
      case 'send-reply': {
        const client = this.client
        if (!client) {
          this.dispatch({
            type: 'reply-settled',
            outcome: { kind: 'failed', message: 'Orca is offline.' }
          })
          return
        }
        void client.sendReply(effect.session, effect.text).then((outcome) => {
          this.dispatch({ type: 'reply-settled', outcome })
        })
      }
    }
  }

  private onEvenHubEvent(event: EvenHubEvent): void {
    const signal = readGlassesSignal(event, this.renderer.listItems)
    if (!signal || !this.gate(signal)) {
      return
    }
    if (signal.kind === 'audio') {
      this.feedAudio(signal.pcm)
    } else if (signal.kind === 'lifecycle') {
      this.onLifecycle(signal.lifecycle)
    } else {
      this.dispatch(signal.input)
    }
  }

  // Why: while the exit dialog is up the host inverts the events: ENTER means the page was cleared
  // for the dialog, and EXIT means the user chose to stay (even-g2-notes page-lifecycle.md).
  private onLifecycle(lifecycle: GlassesLifecycle): void {
    if (lifecycle === 'exit') {
      this.exitDialogOpen = false
      this.renderer.reset()
      this.cancelDictation()
      return
    }
    if (lifecycle === 'background') {
      if (!this.exitDialogOpen) {
        this.background = true
        return
      }
      this.exitDialogOpen = false
    }
    this.background = false
    this.renderer.invalidate()
    void this.renderer.render(glanceScreen(this.state))
    this.schedulePoll(0)
  }

  private schedulePoll(delayMs: number): void {
    if (this.pollTimer) {
      clearTimeout(this.pollTimer)
    }
    this.pollTimer = setTimeout(() => void this.poll(), delayMs)
  }

  private async poll(): Promise<void> {
    this.pollTimer = null
    const client = this.client
    if (!client || this.polling || this.state.connection !== 'connected') {
      return
    }
    this.polling = true
    try {
      const sessions = await client.readSessions(Date.now())
      if (
        client === this.client &&
        sessions &&
        !glanceSessionsEqual(sessions, this.state.sessions)
      ) {
        this.dispatch({ type: 'sessions', sessions })
      }
    } catch (error) {
      console.warn('[orca-glasses] worktree.ps failed', error)
    } finally {
      this.polling = false
      if (client === this.client) {
        this.schedulePoll(this.background ? BACKGROUND_POLL_MS : FOREGROUND_POLL_MS)
      }
    }
  }

  private startDictation(): void {
    const client = this.client
    if (!client) {
      this.dispatch({ type: 'dictation-failed', message: 'Orca is offline.' })
      return
    }
    const id = `glasses-dictation-${Date.now()}-${Math.random().toString(36).slice(2)}`
    const dictation: ActiveDictation = {
      id,
      chunker: createDictationAudioChunker(),
      chain: client.startDictation(id),
      failed: false
    }
    this.dictation = dictation
    dictation.chain = dictation.chain.then(async () => {
      if (!(await this.bridge.audioControl(true, AudioInputSource.Glasses))) {
        throw new Error('The glasses microphone did not open.')
      }
    })
    this.watchDictation(dictation)
  }

  private feedAudio(pcm: Uint8Array): void {
    const dictation = this.dictation
    const client = this.client
    if (!dictation || !client || dictation.failed) {
      return
    }
    for (const chunk of dictation.chunker.push(pcm)) {
      dictation.chain = dictation.chain.then(() => client.feedDictation(dictation.id, chunk))
    }
    this.watchDictation(dictation)
    if (dictation.chunker.full) {
      this.dispatch({ type: 'listening-limit' })
    }
  }

  private finishDictation(): void {
    const dictation = this.dictation
    const client = this.client
    this.dictation = null
    void this.bridge.audioControl(false)
    if (!dictation || !client || dictation.failed) {
      return
    }
    const tail = dictation.chunker.flush()
    void dictation.chain
      .then(() => (tail ? client.feedDictation(dictation.id, tail) : undefined))
      .then(() => client.finishDictation(dictation.id))
      .then(
        (text) => this.dispatch({ type: 'transcript', text }),
        (error: unknown) =>
          this.dispatch({ type: 'dictation-failed', message: describeOrcaError(error) })
      )
  }

  private cancelDictation(): void {
    const dictation = this.dictation
    const client = this.client
    this.dictation = null
    if (!dictation) {
      return
    }
    void this.bridge.audioControl(false)
    void dictation.chain.then(() => client?.cancelDictation(dictation.id)).catch(() => undefined)
  }

  /** A failed start or chunk ends this dictation once, with the host's reason on the glasses. */
  private watchDictation(dictation: ActiveDictation): void {
    dictation.chain.catch((error: unknown) => {
      if (dictation.failed || this.dictation !== dictation) {
        return
      }
      dictation.failed = true
      this.dictation = null
      void this.bridge.audioControl(false)
      this.dispatch({ type: 'dictation-failed', message: describeOrcaError(error) })
    })
  }
}
