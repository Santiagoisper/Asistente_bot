import { PhiCryptoError } from '@ichtys/crypto'
import type { AuditLogParams } from '../chat/persistence'
import { canonicalJson } from '../audit/fingerprint'
import { decryptClinicalContent } from './phi-fields'
import {
  isSealedScreeningJson,
  openScreeningJson,
  sealScreeningJson,
  type OpenedScreeningJson,
  type SealedScreeningJson,
} from './screening-crypto'

/**
 * C3 (docs/compliance/REGULATORY-BASELINE.md, R5), lo anterior al cifrado: decide qué se
 * escribe en cada fila de `screening_assessments` que quedó en claro. La usan el script de
 * operación `scripts/seal-screening-assessments.ts` y la ruta `/api/os/screening-seal`
 * (`screening-seal-run.ts`); está acá para probarla sin base.
 *
 * Sellar no cambia la evaluación: es el mismo contenido, guardado de otra forma. Por eso
 * solo se tocan las dos columnas y el registro de auditoría dice «se cifró».
 */
export type ScreeningColumn = 'assessments' | 'summary'
export const SCREENING_COLUMNS: readonly ScreeningColumn[] = ['assessments', 'summary']

export type ScreeningColumnState = 'plain' | 'sealed' | 'foreign_envelope'

/**
 * `foreign_envelope`: tiene forma de sobre (`enc` y `ciphertext`) pero no es de esta versión.
 * No se envuelve de nuevo: quedaría un sobre dentro de otro y nadie sabría leerlo.
 */
export function screeningColumnState(stored: unknown): ScreeningColumnState {
  if (isSealedScreeningJson(stored)) return 'sealed'
  const envelopeShaped =
    typeof stored === 'object' && stored !== null && !Array.isArray(stored) && 'enc' in stored && 'ciphertext' in stored
  return envelopeShaped ? 'foreign_envelope' : 'plain'
}

export interface ScreeningRowToSeal {
  id: string
  organizationId: string
  assessments: unknown
  summary: unknown
}

export interface RowSealPlan {
  /** Solo las columnas que estaban en claro. Vacío: la fila no se escribe. */
  set: Partial<Record<ScreeningColumn, SealedScreeningJson>>
  /** Columnas con un sobre que no es de esta versión: se dejan como están y se informan. */
  foreign: ScreeningColumn[]
}

/** Lo sellado no vuelve igual al abrirlo. No lleva contenido: solo la fila y la columna. */
export class ScreeningSealRoundTripError extends Error {
  constructor(
    readonly rowId: string,
    readonly column: ScreeningColumn,
  ) {
    super(`La fila ${rowId} no vuelve igual después de cifrar la columna ${column}`)
    this.name = 'ScreeningSealRoundTripError'
  }
}

/**
 * Sella cada columna en claro y comprueba la ida y vuelta antes de devolver nada: lo sellado
 * se abre y se compara con el original. Si no da igual tira `ScreeningSealRoundTripError`, y
 * quien llama cancela la tanda. Sin clave tira `PhiConfigError`.
 */
export function planRowSeal(
  row: ScreeningRowToSeal,
  seal: (value: unknown) => SealedScreeningJson = sealScreeningJson,
  open: (stored: unknown) => OpenedScreeningJson = openScreeningJson,
): RowSealPlan {
  const plan: RowSealPlan = { set: {}, foreign: [] }
  for (const column of SCREENING_COLUMNS) {
    const original = row[column]
    const state = screeningColumnState(original)
    if (state === 'sealed') continue
    if (state === 'foreign_envelope') {
      plan.foreign.push(column)
      continue
    }
    const sealed = seal(original)
    const opened = isSealedScreeningJson(sealed) ? open(sealed) : { ok: false as const }
    if (!opened.ok || canonicalJson(opened.value) !== canonicalJson(original)) {
      throw new ScreeningSealRoundTripError(row.id, column)
    }
    plan.set[column] = sealed
  }
  return plan
}

export type KeyCheck = 'ok' | 'no_sample' | 'mismatch'

/**
 * La clave de la corrida tiene que ser la de esa base: sellar con otra dejaría las filas
 * ilegibles para la aplicación. Se comprueba contra textos ya cifrados que la base tiene
 * (perfiles, evaluaciones selladas). Una sola muestra que no descifra alcanza para cortar.
 * Lo que no tiene forma de cifrado no prueba nada y se ignora.
 */
export function checkKeyAgainstStored(
  samples: readonly string[],
  decrypt: (payload: string) => string = decryptClinicalContent,
): KeyCheck {
  let verified = 0
  for (const sample of samples) {
    try {
      decrypt(sample)
      verified += 1
    } catch (err) {
      if (err instanceof PhiCryptoError && err.code === 'decryption_failed') return 'mismatch'
      if (err instanceof PhiCryptoError && err.code === 'invalid_payload') continue
      throw err
    }
  }
  return verified > 0 ? 'ok' : 'no_sample'
}

export interface OrgSealCount {
  organizationId: string
  rows: number
}

/** Filas por organización, en el orden en que aparece cada organización. */
export function countRowsByOrg(rows: readonly { organizationId: string }[]): OrgSealCount[] {
  const counts = new Map<string, number>()
  for (const row of rows) counts.set(row.organizationId, (counts.get(row.organizationId) ?? 0) + 1)
  return [...counts].map(([organizationId, n]) => ({ organizationId, rows: n }))
}

/**
 * Registro de una tanda para una organización (R3): cantidades y quién responde, nunca
 * contenido. `contentChanged: false` es la afirmación que la ida y vuelta comprobó.
 */
export function sealAuditEntry(count: OrgSealCount, operator: string): AuditLogParams {
  return {
    action: 'admin.action',
    orgId: count.organizationId,
    userId: operator,
    resourceType: 'screening_assessments',
    metadata: {
      type: 'screening_assessments_encrypted_at_rest',
      rows: count.rows,
      columns: [...SCREENING_COLUMNS],
      envelope: 'phi.v1',
      contentChanged: false,
      automated: true,
      humanConfirmed: false,
      operator,
    },
  }
}

/**
 * El host de la base a la que apunta la corrida, sin usuario, contraseña ni nombre de la
 * base. Quien corre el script lo tiene que repetir en `--confirm-host`: es fácil creer que
 * se apunta a la base de prueba y estar apuntando a otra.
 */
export function databaseHostOf(connectionString: string | undefined): string | null {
  if (!connectionString) return null
  try {
    const host = new URL(connectionString).hostname
    return host ? host.toLowerCase() : null
  } catch {
    return null
  }
}

/**
 * A qué base apunta una dirección de conexión: `host/base`, sin usuario ni contraseña. Un mismo
 * host puede tener más de una base, así que el host solo no alcanza para confirmar el destino.
 * El nombre de la base se deja tal cual: en Postgres distingue mayúsculas.
 */
export function databaseTargetOf(connectionString: string | undefined): string | null {
  const host = databaseHostOf(connectionString)
  if (host === null || !connectionString) return null
  try {
    const database = decodeURIComponent(new URL(connectionString).pathname.replace(/^\//, ''))
    return database ? `${host}/${database}` : null
  } catch {
    return null
  }
}
