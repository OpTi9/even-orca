import { describe, expect, it } from 'vitest'
import {
  loadGlassesPairing,
  parseGlassesPairing,
  PAIRING_STORAGE_KEY,
  saveGlassesPairing,
  type PairingStorage
} from './orca-glasses-pairing'

const PUBLIC_KEY = Buffer.alloc(32, 7).toString('base64')

function pairingLink(offer: Record<string, unknown>): string {
  return `orca://pair?code=${Buffer.from(JSON.stringify(offer)).toString('base64url')}`
}

function memoryStorage(): PairingStorage & { values: Map<string, string> } {
  const values = new Map<string, string>()
  return {
    values,
    getLocalStorage: async (key) => values.get(key) ?? '',
    setLocalStorage: async (key, value) => {
      values.set(key, value)
      return true
    }
  }
}

const OFFER = {
  v: 2,
  endpoint: 'ws://192.168.1.20:6768',
  deviceToken: 'device-token',
  publicKeyB64: PUBLIC_KEY
}

describe('parseGlassesPairing', () => {
  it('accepts the desktop mobile pairing link', () => {
    expect(parseGlassesPairing(pairingLink(OFFER))).toEqual({
      ok: true,
      pairing: {
        endpoint: 'ws://192.168.1.20:6768',
        deviceToken: 'device-token',
        publicKeyB64: PUBLIC_KEY
      }
    })
  })

  it('rejects text that is not a pairing link', () => {
    expect(parseGlassesPairing('hello')).toMatchObject({ ok: false })
  })

  it('rejects a remote-server pairing', () => {
    expect(parseGlassesPairing(pairingLink({ ...OFFER, scope: 'runtime' }))).toEqual({
      ok: false,
      message: 'Use the mobile pairing link, not a remote-server one.'
    })
  })
})

describe('pairing storage', () => {
  it('round-trips and clears', async () => {
    const storage = memoryStorage()
    const parsed = parseGlassesPairing(pairingLink(OFFER))
    if (!parsed.ok) {
      throw new Error(parsed.message)
    }
    await saveGlassesPairing(storage, parsed.pairing)
    expect(await loadGlassesPairing(storage)).toEqual(parsed.pairing)
    await saveGlassesPairing(storage, null)
    expect(await loadGlassesPairing(storage)).toBeNull()
  })

  it('treats corrupt stored data as unpaired', async () => {
    const storage = memoryStorage()
    storage.values.set(PAIRING_STORAGE_KEY, '{not json')
    expect(await loadGlassesPairing(storage)).toBeNull()
    storage.values.set(PAIRING_STORAGE_KEY, JSON.stringify({ endpoint: 'ws://x' }))
    expect(await loadGlassesPairing(storage)).toBeNull()
  })
})
