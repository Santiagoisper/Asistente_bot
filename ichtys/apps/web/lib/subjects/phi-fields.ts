import { encryptPhiField, decryptPhiField, PhiCryptoError } from '@ichtys/crypto'

export class PhiConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PhiConfigError'
  }
}

export function encryptClinicalContent(plaintext: string): string {
  try {
    return encryptPhiField(plaintext)
  } catch (err) {
    if (err instanceof PhiCryptoError && err.code === 'missing_key') {
      throw new PhiConfigError('PHI_ENCRYPTION_KEY no configurada en el entorno local')
    }
    throw err
  }
}

export function decryptClinicalContent(payload: string): string {
  try {
    return decryptPhiField(payload)
  } catch (err) {
    if (err instanceof PhiCryptoError && err.code === 'missing_key') {
      throw new PhiConfigError('PHI_ENCRYPTION_KEY no configurada en el entorno local')
    }
    throw err
  }
}

export function encryptProfileJson(profile: Record<string, unknown>): string {
  return encryptClinicalContent(JSON.stringify(profile))
}

export function decryptProfileJson(payload: string): Record<string, unknown> {
  const plain = decryptClinicalContent(payload)
  const parsed: unknown = JSON.parse(plain)
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return {}
  }
  return parsed as Record<string, unknown>
}

/** Heurística ligera — alerta, no bloquea guardado. */
export function detectPossiblePii(text: string): string[] {
  const warnings: string[] = []

  if (/\b\d{7,8}\b/.test(text)) {
    warnings.push('Posible número de documento (DNI)')
  }
  if (/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/.test(text)) {
    warnings.push('Posible email')
  }
  if (/\b(?:\+54\s?)?(?:11|15)[\s-]?\d{4}[\s-]?\d{4}\b/.test(text)) {
    warnings.push('Posible teléfono')
  }

  return warnings
}
