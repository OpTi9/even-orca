import { waitForEvenAppBridge } from '@evenrealities/even_hub_sdk'
import { GlanceApp } from './glance-app'
import { EvenHubPageRenderer } from './glasses/even-hub-page-renderer'
import { loadGlassesPairing } from './orca/orca-glasses-pairing'
import { mountPairingPanel } from './phone/pairing-panel'

async function main(): Promise<void> {
  const bridge = await waitForEvenAppBridge()
  const app = new GlanceApp(bridge, new EvenHubPageRenderer(bridge))
  const pairing = await loadGlassesPairing(bridge)
  const root = document.getElementById('app')
  if (root) {
    mountPairingPanel(root, app, bridge, pairing)
  }
  // Auto-connect: the phone is usually out of reach while the glasses are on.
  app.setPairing(pairing)
}

void main()
