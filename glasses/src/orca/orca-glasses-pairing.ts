import { z } from 'zod'
import { parsePairingCode } from '../../../mobile/src/transport/pairing'

// Credentials live in the Even App's bridge storage: WebView localStorage does not survive an app
// or glasses restart inside an .ehpk.

export const PAIRING_STORAGE_KEY = 'orca.glasses.pairing.v1'

const storedPairingSchema = z.object({
  endpoint: z.string().min(1),
  deviceToken: z.string().min(1),
  publicKeyB64: z.string().min(1)
})

export type OrcaGlassesPairing = z.output<typeof storedPairingSchema>

export type PairingStorage = {
  getLocalStorage: (key: string) => Promise<string>
  setLocalStorage: (key: string, value: string) => Promise<boolean>
}

export type PairingParseResult =
  | { ok: true; pairing: OrcaGlassesPairing }
  | { ok: false; message: string }

/** Accepts the `orca://pair?code=...` link (or bare code) from Orca Settings > Mobile. */
export function parseGlassesPairing(input: string): PairingParseResult {
  const offer = parsePairingCode(input)
  if (!offer) {
    return { ok: false, message: 'That is not an Orca pairing link.' }
  }
  if (offer.scope === 'runtime') {
    return { ok: false, message: 'Use the mobile pairing link, not a remote-server one.' }
  }
  if (!/^wss?:\/\//i.test(offer.endpoint)) {
    return { ok: false, message: 'This pairing has no direct address the glasses can reach.' }
  }
  return {
    ok: true,
    pairing: {
      endpoint: offer.endpoint,
      deviceToken: offer.deviceToken,
      publicKeyB64: offer.publicKeyB64
    }
  }
}

export async function loadGlassesPairing(
  storage: PairingStorage
): Promise<OrcaGlassesPairing | null> {
  try {
    const raw = await storage.getLocalStorage(PAIRING_STORAGE_KEY)
    if (!raw) {
      return null
    }
    const parsed = storedPairingSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

export async function saveGlassesPairing(
  storage: PairingStorage,
  pairing: OrcaGlassesPairing | null
): Promise<boolean> {
  return storage.setLocalStorage(PAIRING_STORAGE_KEY, pairing ? JSON.stringify(pairing) : '')
}
