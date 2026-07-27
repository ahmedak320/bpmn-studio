/** Return a defensive byte copy backed by a concrete, non-shared ArrayBuffer. */
export function copyBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(new ArrayBuffer(bytes.byteLength))
  copy.set(bytes)
  return copy
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const subtle = globalThis.crypto?.subtle
  if (!subtle) {
    throw new Error('SHA-256 is unavailable because Web Crypto is not supported.')
  }
  const owned = copyBytes(bytes)
  const digest = await subtle.digest('SHA-256', owned)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function equalHash(left: string, right: string): boolean {
  return left.trim().toLowerCase() === right.trim().toLowerCase()
}
