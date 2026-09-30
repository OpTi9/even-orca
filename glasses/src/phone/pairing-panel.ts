import type { GlanceConnection, GlanceState } from '../glance/glance-controller'
import type { GlanceApp } from '../glance-app'
import {
  parseGlassesPairing,
  saveGlassesPairing,
  type OrcaGlassesPairing,
  type PairingStorage
} from '../orca/orca-glasses-pairing'

// The phone-side page the Even App shows in its WebView; the glasses UI is driven by GlanceApp.

const CONNECTION_LABELS: Record<GlanceConnection, string> = {
  unpaired: 'Not paired',
  connecting: 'Connecting...',
  connected: 'Connected',
  offline: 'Unreachable, retrying',
  'auth-failed': 'Pairing refused. Pair again.'
}

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {}
): HTMLElementTagNameMap[K] {
  return Object.assign(document.createElement(tag), props)
}

export function mountPairingPanel(
  root: HTMLElement,
  app: GlanceApp,
  storage: PairingStorage,
  initialPairing: OrcaGlassesPairing | null
): void {
  const status = element('p', { className: 'status' })
  const sessions = element('p', { className: 'hint' })
  const input = element('textarea', {
    rows: 3,
    placeholder: 'orca://pair?code=...',
    spellcheck: false
  })
  const error = element('p', { className: 'error', hidden: true })
  const pairButton = element('button', { type: 'button', textContent: 'Pair' })
  const forgetButton = element('button', {
    type: 'button',
    className: 'secondary',
    textContent: 'Forget pairing',
    hidden: initialPairing === null
  })

  const showError = (message: string | null): void => {
    error.textContent = message ?? ''
    error.hidden = message === null
  }

  pairButton.addEventListener('click', () => {
    const parsed = parseGlassesPairing(input.value)
    if (!parsed.ok) {
      showError(parsed.message)
      return
    }
    showError(null)
    input.value = ''
    forgetButton.hidden = false
    void saveGlassesPairing(storage, parsed.pairing)
    app.setPairing(parsed.pairing)
  })

  forgetButton.addEventListener('click', () => {
    forgetButton.hidden = true
    void saveGlassesPairing(storage, null)
    app.setPairing(null)
  })

  const render = (state: GlanceState): void => {
    status.textContent = CONNECTION_LABELS[state.connection]
    status.dataset.connection = state.connection
    sessions.textContent =
      state.connection === 'connected'
        ? `${state.sessions.length} oh-my-pi session${state.sessions.length === 1 ? '' : 's'} on the glasses.`
        : ''
  }

  root.replaceChildren(
    element('h1', { textContent: 'Orca for G2' }),
    status,
    sessions,
    element('label', {
      textContent: 'Pairing link from Orca Settings > Mobile',
      htmlFor: 'pairing-input'
    }),
    Object.assign(input, { id: 'pairing-input' }),
    error,
    pairButton,
    forgetButton,
    element('p', {
      className: 'hint',
      textContent:
        'Glasses: tap a session to read it, tap again (or hold) to reply by voice, double-tap to go back.'
    })
  )
  render(app.snapshot)
  app.subscribe(render)
}
