import { PhiCryptoError } from '@ichtys/crypto'
import { decryptClinicalContent, encryptClinicalContent, PhiConfigError } from './phi-fields'

/**
 * C3 (docs/compliance/REGULATORY-BASELINE.md, R5): lo que se guarda de una evaluación de
 * elegibilidad va cifrado. El motivo de cada criterio cita valores del sujeto («HbA1c 7,9 % ≥
 * 7,0 %…»), así que la instantánea es dato clínico aunque la tabla naciera como «sin PHI».
 *
 * Las columnas `assessments` y `summary` siguen siendo JSONB: lo que se guarda en cada una es
 * un sobre `{ enc, ciphertext }`. No hace falta cambiar la tabla, y una fila anterior al
 * cifrado (la lista o el resumen en claro) se sigue leyendo hasta que la migración de datos
 * la selle.
 */
const ENVELOPE = 'phi.v1'

export interface SealedScreeningJson {
  enc: typeof ENVELOPE
  ciphertext: string
}

const looksLikeEnvelope = (stored: unknown): stored is { enc: unknown; ciphertext: unknown } =>
  typeof stored === 'object' && stored !== null && !Array.isArray(stored) && 'enc' in stored && 'ciphertext' in stored

/** `true` si lo guardado es un sobre cifrado de esta versión. */
export function isSealedScreeningJson(stored: unknown): stored is SealedScreeningJson {
  return looksLikeEnvelope(stored) && stored.enc === ENVELOPE && typeof stored.ciphertext === 'string'
}

/** Lo que va a la columna JSONB. Sin clave de cifrado tira `PhiConfigError`: no se guarda en claro. */
export function sealScreeningJson(value: unknown): SealedScreeningJson {
  return { enc: ENVELOPE, ciphertext: encryptClinicalContent(JSON.stringify(value)) }
}

export type OpenedScreeningJson = { ok: true; value: unknown } | { ok: false }

/**
 * Lee lo guardado en la columna. Una fila anterior al cifrado se devuelve tal cual. Un sobre
 * que no se puede leer por culpa de la fila (formato, JSON, marca desconocida) vuelve como
 * `{ ok: false }`. Lo que falla por el entorno sale como `PhiConfigError`: clave ausente y
 * también un sobre que no descifra, porque el formato no lleva identificador de clave y con
 * la clave correcta eso casi no pasa (mismo criterio que el perfil, #154).
 */
export function openScreeningJson(stored: unknown): OpenedScreeningJson {
  if (!looksLikeEnvelope(stored)) return { ok: true, value: stored }
  if (!isSealedScreeningJson(stored)) return { ok: false }
  let plain: string
  try {
    plain = decryptClinicalContent(stored.ciphertext)
  } catch (err) {
    if (err instanceof PhiCryptoError && err.code === 'invalid_payload') return { ok: false }
    if (err instanceof PhiCryptoError && err.code === 'decryption_failed') {
      throw new PhiConfigError('La evaluación guardada no descifra con la clave de este entorno')
    }
    throw err
  }
  try {
    return { ok: true, value: JSON.parse(plain) }
  } catch {
    return { ok: false }
  }
}
