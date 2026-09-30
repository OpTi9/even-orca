import { describe, expect, it } from 'vitest'
import {
  createDictationAudioChunker,
  DICTATION_CHUNK_BYTES,
  encodeBase64,
  MAX_DICTATION_SECONDS
} from './dictation-audio-chunker'

// The glasses' 10 ms frame at 16 kHz S16LE mono.
const FRAME_BYTES = 320

function frame(fill: number, bytes = FRAME_BYTES): Uint8Array {
  return new Uint8Array(bytes).fill(fill)
}

function decodedLength(base64: string): number {
  return atob(base64).length
}

describe('createDictationAudioChunker', () => {
  it('batches frames into quarter-second chunks', () => {
    const chunker = createDictationAudioChunker()
    const chunks = Array.from({ length: 50 }, () => chunker.push(frame(1))).flat()
    expect(DICTATION_CHUNK_BYTES).toBe(8_000)
    expect(chunks.map(decodedLength)).toEqual([8_000, 8_000])
    expect(chunker.flush()).toBeNull()
  })

  it('flushes the tail and never splits a sample', () => {
    const chunker = createDictationAudioChunker(8)
    expect(chunker.push(frame(7, 11)).map(decodedLength)).toEqual([8])
    expect(decodedLength(chunker.flush() ?? '')).toBe(2)
    expect(chunker.flush()).toBeNull()
  })

  it('preserves byte order across chunk boundaries', () => {
    const chunker = createDictationAudioChunker(4)
    const chunks = [
      ...chunker.push(new Uint8Array([0, 1, 2])),
      ...chunker.push(new Uint8Array([3, 4, 5]))
    ]
    const tail = chunker.flush()
    const bytes = [...chunks, ...(tail ? [tail] : [])].flatMap((chunk) =>
      Array.from(atob(chunk), (char) => char.charCodeAt(0))
    )
    expect(bytes).toEqual([0, 1, 2, 3, 4, 5])
  })

  it('stops accepting audio at the recording limit', () => {
    const chunker = createDictationAudioChunker()
    const limitBytes = 16_000 * 2 * MAX_DICTATION_SECONDS
    let total = 0
    for (let i = 0; i < limitBytes / FRAME_BYTES + 10; i += 1) {
      total += chunker.push(frame(2)).reduce((sum, chunk) => sum + decodedLength(chunk), 0)
    }
    expect(chunker.full).toBe(true)
    expect(total).toBe(limitBytes)
  })
})

describe('encodeBase64', () => {
  it('matches the platform encoder for binary data', () => {
    const bytes = Uint8Array.from({ length: 70_000 }, (_, index) => index % 256)
    expect(encodeBase64(bytes)).toBe(Buffer.from(bytes).toString('base64'))
  })
})
