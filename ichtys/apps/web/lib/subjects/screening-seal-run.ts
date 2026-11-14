/**
 * C3 (docs/compliance/REGULATORY-BASELINE.md, R5): el recorrido del sellado de **una**
 * organización, sin base. Comprueba la clave, sella por tandas, respeta un tope de tiempo y
 * arma el registro de cada tanda. Quien toca la base es el depósito (`screening-seal-store.ts`).
 *
 * Se puede repetir: una fila ya sellada no se vuelve a elegir, y lo que no entró en el tope
 * de tiempo queda para el pedido siguiente.
 */
import type { AuditLogParams } from '../chat/persistence'
import { PhiConfigError } from './phi-fields'
import { sealScreeningJson } from './screening-crypto'
import { checkKeyAgainstStored, planRowSeal, sealAuditEntry, type KeyCheck, type RowSealPlan, type ScreeningRowToSeal } from './screening-seal'

/** Lo que el recorrido necesita de la base, siempre dentro de una organización. */
export interface SealStore {
  countRows(): Promise<number>
  /** Filas con alguna columna en claro. */
  countPlain(): Promise<number>
  /** Filas con un sobre que no es de esta versión: no se tocan, se informan. */
  countForeign(): Promise<number>
  /** Textos ya cifrados de la organización, para comprobar que la clave es la suya. */
  keySamples(): Promise<string[]>
  /**
   * Una tanda en **una** transacción: toma hasta `limit` filas en claro (sin esperar a las que
   * otra escritura tiene tomadas), escribe lo que `plan` devuelve y, si escribió algo, el
   * registro que arma `audit`. Devuelve cuántas filas escribió. Si `plan` tira, no queda nada.
   */
  sealBatch(limit: number, plan: (row: ScreeningRowToSeal) => RowSealPlan, audit: (rows: number) => AuditLogParams): Promise<number>
}

export type OrgSealOutcome =
  | { status: 'done' | 'partial'; sealed: number; batches: number; remaining: number; foreignEnvelope: number }
  | { status: 'no_key' | 'key_mismatch' | 'key_unverified' }

export interface OrgSealOptions {
  orgId: string
  /** Quién lo pidió: va al registro de cada tanda. */
  userId: string
  batchSize: number
  /** Pasado este tiempo no se abre otra tanda. */
  budgetMs: number
  now?: () => number
  checkKey?: (samples: readonly string[]) => KeyCheck
  /** Tira `PhiConfigError` si falta la clave. */
  probeKey?: () => void
}

export async function runOrgSeal(store: SealStore, options: OrgSealOptions): Promise<OrgSealOutcome> {
  const { orgId, userId, batchSize, budgetMs } = options
  const now = options.now ?? Date.now
  const checkKey = options.checkKey ?? checkKeyAgainstStored
  const probeKey = options.probeKey ?? (() => void sealScreeningJson({ probe: true }))

  const started = now()
  let remaining = await store.countPlain()
  let sealed = 0
  let batches = 0

  if (remaining > 0) {
    try {
      probeKey()
    } catch (err) {
      if (err instanceof PhiConfigError) return { status: 'no_key' }
      throw err
    }
    // La clave tiene que ser la de esta base: sellar con otra deja las filas ilegibles.
    const keyCheck = checkKey(await store.keySamples())
    if (keyCheck === 'mismatch') return { status: 'key_mismatch' }
    if (keyCheck === 'no_sample') return { status: 'key_unverified' }

    while (now() - started < budgetMs) {
      const written = await store.sealBatch(batchSize, planRowSeal, (rows) => sealAuditEntry({ organizationId: orgId, rows }, userId))
      if (written > 0) {
        sealed += written
        batches += 1
      }
      // Una tanda incompleta es la última: o no queda nada, o lo que queda lo tiene otra escritura.
      if (written < batchSize) break
    }
    remaining = await store.countPlain()
  }

  const foreignEnvelope = await store.countForeign()
  return { status: remaining === 0 && foreignEnvelope === 0 ? 'done' : 'partial', sealed, batches, remaining, foreignEnvelope }
}
