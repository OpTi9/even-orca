import {
  DICTATION_SAMPLE_RATE,
  MAX_DICTATION_AUDIO_CHUNK_BYTES,
  PCM_BYTES_PER_SAMPLE
} from '../../../src/shared/rpc-contract/speech-params'

// The glasses deliver 10 ms S16LE mono frames at 16 kHz, the host's dictation format, so frames
// are only batched: one RPC per 10 ms frame would swamp the link.

/** A quarter second per `speech.dictation.chunk`. */
export const DICTATION_CHUNK_BYTES = (DICTATION_SAMPLE_RATE * PCM_BYTES_PER_SAMPLE) / 4

/** Ends listening that nobody stopped (a missed release or tap). */
export const MAX_DICTATION_SECONDS = 60

const MAX_DICTATION_BYTES = DICTATION_SAMPLE_RATE * PCM_BYTES_PER_SAMPLE * MAX_DICTATION_SECONDS

export function encodeBase64(bytes: Uint8Array): string {
  let binary = ''
  const step = 0x8000
  for (let offset = 0; offset < bytes.length; offset += step) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + step))
  }
  return btoa(binary)
}

export type DictationAudioChunker = {
  /** Base64 chunks ready to send, if this frame completed any. */
  push: (frame: Uint8Array) => string[]
  /** The partial tail, sent at finish. */
  flush: () => string | null
  /** True once the recording hit MAX_DICTATION_SECONDS; later frames are dropped. */
  readonly full: boolean
}

export function createDictationAudioChunker(
  chunkBytes = DICTATION_CHUNK_BYTES
): DictationAudioChunker {
  const size = Math.min(chunkBytes, MAX_DICTATION_AUDIO_CHUNK_BYTES)
  let pending = new Uint8Array(size)
  let pendingLength = 0
  let total = 0
  let full = false
  const take = (): string => {
    // A trailing odd byte would split a sample across chunks; the host drops a half sample.
    const even = pendingLength - (pendingLength % PCM_BYTES_PER_SAMPLE)
    const chunk = encodeBase64(pending.subarray(0, even))
    const carry = pending.slice(even, pendingLength)
    pending = new Uint8Array(size)
    pending.set(carry)
    pendingLength = carry.length
    return chunk
  }
  return {
    push(frame) {
      const chunks: string[] = []
      let offset = 0
      while (offset < frame.length && !full) {
        const room = Math.min(size - pendingLength, MAX_DICTATION_BYTES - total)
        const count = Math.min(room, frame.length - offset)
        pending.set(frame.subarray(offset, offset + count), pendingLength)
        pendingLength += count
        total += count
        offset += count
        full = total >= MAX_DICTATION_BYTES
        if (pendingLength >= size) {
          chunks.push(take())
        }
      }
      return chunks
    },
    flush() {
      return pendingLength >= PCM_BYTES_PER_SAMPLE ? take() : null
    },
    get full() {
      return full
    }
  }
}
