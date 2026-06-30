import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto'

const ALGO = 'aes-256-gcm'
const IV_BYTES = 12
const TAG_BYTES = 16
const KEY_BYTES = 32

function encryptionKey(): Buffer {
  const secret = process.env.ORG_LLM_KEYS_ENCRYPTION_SECRET?.trim()
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('ORG_LLM_KEYS_ENCRYPTION_SECRET is required in production')
    }
    console.warn('[org-llm-crypto] Using dev-only encryption fallback — set ORG_LLM_KEYS_ENCRYPTION_SECRET')
    return scryptSync('ichtys-dev-insecure', 'org-llm-keys', KEY_BYTES)
  }
  return scryptSync(secret, 'ichtys-org-llm-keys-v1', KEY_BYTES)
}

export function encryptJson(value: unknown): string {
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv(ALGO, encryptionKey(), iv)
  const plaintext = Buffer.from(JSON.stringify(value), 'utf8')
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, encrypted]).toString('base64')
}

export function decryptJson<T>(payload: string): T {
  const buf = Buffer.from(payload, 'base64')
  const iv = buf.subarray(0, IV_BYTES)
  const tag = buf.subarray(IV_BYTES, IV_BYTES + TAG_BYTES)
  const encrypted = buf.subarray(IV_BYTES + TAG_BYTES)
  const decipher = createDecipheriv(ALGO, encryptionKey(), iv)
  decipher.setAuthTag(tag)
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()])
  return JSON.parse(decrypted.toString('utf8')) as T
}
