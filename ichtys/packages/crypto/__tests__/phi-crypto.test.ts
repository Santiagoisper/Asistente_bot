import { describe, expect, it } from 'vitest'

import {
  PhiCryptoError,
  decryptPhiField,
  encryptPhiField,
  generatePhiEncryptionKey,
  isEncryptedPhiField,
} from '../phi-crypto'

describe('phi-crypto', () => {
  const testKey = generatePhiEncryptionKey()

  it('generates a 64-char hex key', () => {
    const key = generatePhiEncryptionKey()
    expect(key).toMatch(/^[0-9a-f]{64}$/)
  })

  it('encrypts and decrypts round-trip', () => {
    const plaintext = 'Paciente con metformina 850mg. HbA1c 8.2%.'
    const encrypted = encryptPhiField(plaintext, testKey)

    expect(isEncryptedPhiField(encrypted)).toBe(true)
    expect(encrypted).not.toContain('metformina')
    expect(decryptPhiField(encrypted, testKey)).toBe(plaintext)
  })

  it('produces different ciphertext for same plaintext (random IV)', () => {
    const plaintext = 'Evolución clínica de prueba'
    const a = encryptPhiField(plaintext, testKey)
    const b = encryptPhiField(plaintext, testKey)
    expect(a).not.toBe(b)
    expect(decryptPhiField(a, testKey)).toBe(plaintext)
    expect(decryptPhiField(b, testKey)).toBe(plaintext)
  })

  it('accepts base64-encoded keys', () => {
    const hexKey = generatePhiEncryptionKey()
    const base64Key = Buffer.from(hexKey, 'hex').toString('base64')
    const encrypted = encryptPhiField('test', base64Key)
    expect(decryptPhiField(encrypted, base64Key)).toBe('test')
  })

  it('rejects missing key', () => {
    const prev = process.env.PHI_ENCRYPTION_KEY
    delete process.env.PHI_ENCRYPTION_KEY

    expect(() => encryptPhiField('test')).toThrow(PhiCryptoError)
    expect(() => encryptPhiField('test')).toThrow(/not configured/)

    if (prev !== undefined) process.env.PHI_ENCRYPTION_KEY = prev
  })

  it('rejects invalid key length', () => {
    expect(() => encryptPhiField('test', 'tooshort')).toThrow(PhiCryptoError)
  })

  it('rejects tampered ciphertext', () => {
    const encrypted = encryptPhiField('sensitive', testKey)
    const tampered = encrypted.replace(/.$/, encrypted.endsWith('A') ? 'B' : 'A')

    expect(() => decryptPhiField(tampered, testKey)).toThrow(PhiCryptoError)
    expect(() => decryptPhiField(tampered, testKey)).toThrow(/decryption failed/)
  })

  it('rejects plaintext payloads', () => {
    expect(isEncryptedPhiField('plain text')).toBe(false)
    expect(() => decryptPhiField('plain text', testKey)).toThrow(PhiCryptoError)
  })
})
