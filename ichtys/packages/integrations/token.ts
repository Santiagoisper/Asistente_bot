import { createPrivateKey, createPublicKey, randomUUID, sign, verify, type KeyObject } from 'node:crypto'
import { z } from 'zod'
import { OS_MODULES, type OsModule } from './summary-schema'

export const OS_TOKEN_ISSUER = 'clinical-research-os'
/** Vida máxima del token, en segundos. */
export const OS_TOKEN_TTL_SECONDS = 60
/** Tolerancia de reloj entre el OS y el satélite, en segundos. */
const CLOCK_SKEW_SECONDS = 5

export type OsTokenErrorCode =
  | 'invalid_key'
  | 'malformed'
  | 'bad_signature'
  | 'wrong_issuer'
  | 'wrong_audience'
  | 'expired'
  | 'not_yet_valid'
  | 'lifetime_too_long'

export class OsTokenError extends Error {
  constructor(readonly code: OsTokenErrorCode) {
    super(`OS token rejected: ${code}`)
    this.name = 'OsTokenError'
  }
}

const claimsSchema = z
  .object({
    iss: z.string(),
    aud: z.enum(OS_MODULES),
    sub: z.string().min(1).max(200),
    org: z.string().min(1).max(200),
    iat: z.number().int(),
    exp: z.number().int(),
    jti: z.string().min(1).max(100),
  })
  .strict()
export type OsTokenClaims = z.infer<typeof claimsSchema>

const HEADER = { alg: 'EdDSA', typ: 'JWT' } as const

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url')
}

/** Las variables de entorno suelen traer el PEM con "\n" literales. */
export function normalizePem(pem: string): string {
  return pem.replace(/\\n/g, '\n').trim()
}

function loadKey(pem: string, kind: 'private' | 'public'): KeyObject {
  let key: KeyObject
  try {
    key = kind === 'private' ? createPrivateKey(normalizePem(pem)) : createPublicKey(normalizePem(pem))
  } catch {
    throw new OsTokenError('invalid_key')
  }
  if (key.asymmetricKeyType !== 'ed25519') throw new OsTokenError('invalid_key')
  return key
}

export function signOsToken(input: {
  module: OsModule
  userId: string
  orgId: string
  privateKeyPem: string
  now?: Date
}): string {
  const key = loadKey(input.privateKeyPem, 'private')
  const iat = Math.floor((input.now ?? new Date()).getTime() / 1000)
  const claims: OsTokenClaims = {
    iss: OS_TOKEN_ISSUER,
    aud: input.module,
    sub: input.userId,
    org: input.orgId,
    iat,
    exp: iat + OS_TOKEN_TTL_SECONDS,
    jti: randomUUID(),
  }
  const signingInput = `${b64url(JSON.stringify(HEADER))}.${b64url(JSON.stringify(claims))}`
  const signature = sign(null, Buffer.from(signingInput), key)
  return `${signingInput}.${b64url(signature)}`
}

function parseJsonSegment(segment: string): unknown {
  try {
    return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'))
  } catch {
    throw new OsTokenError('malformed')
  }
}

/**
 * Verificación de referencia para los satélites. El orden importa: primero la
 * firma, y recién después se confía en lo que dicen los reclamos.
 */
export function verifyOsToken(
  token: string,
  opts: { module: OsModule; publicKeyPem: string; now?: Date },
): OsTokenClaims {
  const key = loadKey(opts.publicKeyPem, 'public')
  const parts = token.split('.')
  if (parts.length !== 3) throw new OsTokenError('malformed')
  const [headerPart, payloadPart, signaturePart] = parts as [string, string, string]

  const header = parseJsonSegment(headerPart)
  if (
    typeof header !== 'object' ||
    header === null ||
    (header as { alg?: unknown }).alg !== HEADER.alg
  ) {
    throw new OsTokenError('malformed')
  }

  let signatureOk = false
  try {
    signatureOk = verify(
      null,
      Buffer.from(`${headerPart}.${payloadPart}`),
      key,
      Buffer.from(signaturePart, 'base64url'),
    )
  } catch {
    signatureOk = false
  }
  if (!signatureOk) throw new OsTokenError('bad_signature')

  const parsed = claimsSchema.safeParse(parseJsonSegment(payloadPart))
  if (!parsed.success) throw new OsTokenError('malformed')
  const claims = parsed.data

  const now = Math.floor((opts.now ?? new Date()).getTime() / 1000)
  if (claims.iss !== OS_TOKEN_ISSUER) throw new OsTokenError('wrong_issuer')
  if (claims.aud !== opts.module) throw new OsTokenError('wrong_audience')
  if (claims.exp - claims.iat > OS_TOKEN_TTL_SECONDS) throw new OsTokenError('lifetime_too_long')
  if (claims.iat > now + CLOCK_SKEW_SECONDS) throw new OsTokenError('not_yet_valid')
  if (claims.exp <= now - CLOCK_SKEW_SECONDS) throw new OsTokenError('expired')
  return claims
}
