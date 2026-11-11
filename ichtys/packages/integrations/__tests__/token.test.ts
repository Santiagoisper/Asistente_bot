import { generateKeyPairSync } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { OsTokenError, OS_TOKEN_TTL_SECONDS, signOsToken, verifyOsToken } from '../token'

function keyPair(type: 'ed25519' | 'rsa' = 'ed25519') {
  const pair =
    type === 'ed25519'
      ? generateKeyPairSync('ed25519')
      : generateKeyPairSync('rsa', { modulusLength: 2048 })
  return {
    privateKeyPem: pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    publicKeyPem: pair.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  }
}

const NOW = new Date('2026-11-10T12:00:00.000Z')
const base = { module: 'queries' as const, userId: 'user_1', orgId: 'org_1' }

function codeOf(fn: () => unknown): string {
  try {
    fn()
  } catch (err) {
    if (err instanceof OsTokenError) return err.code
    throw err
  }
  return 'no-error'
}

describe('token del OS (EdDSA)', () => {
  it('ida y vuelta: el satélite recupera módulo, usuario y organización', () => {
    const keys = keyPair()
    const token = signOsToken({ ...base, privateKeyPem: keys.privateKeyPem, now: NOW })
    const claims = verifyOsToken(token, { module: 'queries', publicKeyPem: keys.publicKeyPem, now: NOW })
    expect(claims).toMatchObject({ iss: 'clinical-research-os', aud: 'queries', sub: 'user_1', org: 'org_1' })
    expect(claims.exp - claims.iat).toBe(OS_TOKEN_TTL_SECONDS)
    expect(OS_TOKEN_TTL_SECONDS).toBeLessThanOrEqual(60)
  })

  it('acepta la clave con saltos de línea escapados, como llega por variable de entorno', () => {
    const keys = keyPair()
    const escaped = keys.privateKeyPem.replace(/\n/g, '\\n')
    const token = signOsToken({ ...base, privateKeyPem: escaped, now: NOW })
    expect(() => verifyOsToken(token, { module: 'queries', publicKeyPem: keys.publicKeyPem, now: NOW })).not.toThrow()
  })

  it('rechaza un token emitido para otro módulo', () => {
    const keys = keyPair()
    const token = signOsToken({ ...base, privateKeyPem: keys.privateKeyPem, now: NOW })
    expect(codeOf(() => verifyOsToken(token, { module: 'viaticos', publicKeyPem: keys.publicKeyPem, now: NOW }))).toBe(
      'wrong_audience',
    )
  })

  it('rechaza un token vencido', () => {
    const keys = keyPair()
    const token = signOsToken({ ...base, privateKeyPem: keys.privateKeyPem, now: NOW })
    const later = new Date(NOW.getTime() + 5 * 60_000)
    expect(codeOf(() => verifyOsToken(token, { module: 'queries', publicKeyPem: keys.publicKeyPem, now: later }))).toBe(
      'expired',
    )
  })

  it('rechaza un token fechado en el futuro', () => {
    const keys = keyPair()
    const token = signOsToken({ ...base, privateKeyPem: keys.privateKeyPem, now: NOW })
    const earlier = new Date(NOW.getTime() - 5 * 60_000)
    expect(codeOf(() => verifyOsToken(token, { module: 'queries', publicKeyPem: keys.publicKeyPem, now: earlier }))).toBe(
      'not_yet_valid',
    )
  })

  it('rechaza un cuerpo alterado después de firmar', () => {
    const keys = keyPair()
    const token = signOsToken({ ...base, privateKeyPem: keys.privateKeyPem, now: NOW })
    const [header, payload, signature] = token.split('.') as [string, string, string]
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>
    const forged = Buffer.from(JSON.stringify({ ...claims, org: 'org_ajena' })).toString('base64url')
    expect(
      codeOf(() =>
        verifyOsToken(`${header}.${forged}.${signature}`, { module: 'queries', publicKeyPem: keys.publicKeyPem, now: NOW }),
      ),
    ).toBe('bad_signature')
  })

  it('rechaza una firma hecha con otra clave', () => {
    const token = signOsToken({ ...base, privateKeyPem: keyPair().privateKeyPem, now: NOW })
    expect(
      codeOf(() => verifyOsToken(token, { module: 'queries', publicKeyPem: keyPair().publicKeyPem, now: NOW })),
    ).toBe('bad_signature')
  })

  it('rechaza texto que no es un token', () => {
    const keys = keyPair()
    for (const bad of ['', 'abc', 'a.b', 'a.b.c.d', '%%%.%%%.%%%']) {
      expect(codeOf(() => verifyOsToken(bad, { module: 'queries', publicKeyPem: keys.publicKeyPem, now: NOW }))).toBe(
        'malformed',
      )
    }
  })

  it('no firma con una clave que no es Ed25519 ni con texto que no es una clave', () => {
    expect(codeOf(() => signOsToken({ ...base, privateKeyPem: keyPair('rsa').privateKeyPem, now: NOW }))).toBe('invalid_key')
    expect(codeOf(() => signOsToken({ ...base, privateKeyPem: 'no-es-una-clave', now: NOW }))).toBe('invalid_key')
  })
})
