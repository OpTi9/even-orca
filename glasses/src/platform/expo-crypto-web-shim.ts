// The one expo-crypto call the reused mobile transport makes, backed by the WebView's Web Crypto.
export function getRandomBytes(byteCount: number): Uint8Array {
  const bytes = new Uint8Array(byteCount)
  crypto.getRandomValues(bytes)
  return bytes
}
