import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

/**
 * Field-level encryption for PHI stored in Postgres (Fase 0 — Compliance Foundation).
 *
 * Algorithm: AES-256-GCM with 12-byte IV and 16-byte auth tag.
 * Wire format: v1:<iv_b64>:<tag_b64>:<ciphertext_b64>
 *
 * Key source: PHI_ENCRYPTION_KEY env var (32 bytes as 64-char hex or base64).
 * Used by clinical_evolutions.content and patient_profiles (Fase 1+).
 */

const ALGORITHM = 'aes-256-gcm' as const
const IV_LENGTH = 12
const KEY_LENGTH = 32
const VERSION = 'v1'
const ENV_KEY = 'PHI_ENCRYPTION_KEY'

export type PhiCryptoErrorCode =
  | 'missing_key'
  | 'invalid_key'
  | 'invalid_payload'
  | 'decryption_failed'
  | 'unsupported_version'

export class PhiCryptoError extends Error {
  constructor(
    readonly code: PhiCryptoErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'PhiCryptoError'
  }
}

/** Generates a new 256-bit key encoded as 64-char lowercase hex. */
export function generatePhiEncryptionKey(): string {
  return randomBytes(KEY_LENGTH).toString('hex')
}

function decodeKeyMaterial(rawKey: string): Buffer {
  const trimmed = rawKey.trim()
  if (trimmed.length === 0) {
    throw new PhiCryptoError('invalid_key', 'PHI encryption key is empty')
  }

  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    return Buffer.from(trimmed, 'hex')
  }

  const fromBase64 = Buffer.from(trimmed, 'base64')
  if (fromBase64.length === KEY_LENGTH) {
    return fromBase64
  }

  throw new PhiCryptoError(
    'invalid_key',
    'PHI encryption key must be 32 bytes (64 hex chars or 44-char base64)',
  )
}

function resolveEncryptionKey(keyOverride?: string): Buffer {
  const raw = keyOverride ?? process.env[ENV_KEY]
  if (!raw) {
    throw new PhiCryptoError(
      'missing_key',
      `${ENV_KEY} is not configured`,
    )
  }
  return decodeKeyMaterial(raw)
}

/** Returns true if the value looks like an encrypted PHI payload. */
export function isEncryptedPhiField(value: string): boolean {
  if (!value.startsWith(`${VERSION}:`)) return false
  const parts = value.split(':')
  return parts.length === 4 && parts.every((part) => part.length > 0)
}

/**
 * Encrypts plaintext for storage. Never log the return value in application logs.
 */
export function encryptPhiField(plaintext: string, keyOverride?: string): string {
  const key = resolveEncryptionKey(keyOverride)
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv(ALGORITHM, key, iv)

  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ])
  const authTag = cipher.getAuthTag()

  return [
    VERSION,
    iv.toString('base64url'),
    authTag.toString('base64url'),
    encrypted.toString('base64url'),
  ].join(':')
}

/**
 * Decrypts a field previously encrypted with encryptPhiField.
 */
export function decryptPhiField(payload: string, keyOverride?: string): string {
  if (!isEncryptedPhiField(payload)) {
    throw new PhiCryptoError('invalid_payload', 'Value is not a valid encrypted PHI field')
  }

  const [, ivB64, tagB64, ciphertextB64] = payload.split(':') as [string, string, string, string]
  const key = resolveEncryptionKey(keyOverride)

  try {
    const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivB64, 'base64url'))
    decipher.setAuthTag(Buffer.from(tagB64, 'base64url'))

    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(ciphertextB64, 'base64url')),
      decipher.final(),
    ])

    return decrypted.toString('utf8')
  } catch {
    throw new PhiCryptoError('decryption_failed', 'PHI field decryption failed')
  }
}
