/**
 * C3 (docs/compliance/REGULATORY-BASELINE.md, R5): el recorrido del sellado, sin base.
 * `runSeal` recorre todas las organizaciones a nombre del operador; `runOrgSeal` hace una:
 * comprueba la clave, sella por tandas, respeta un tope de tiempo y arma el registro de cada
 * tanda. Quien toca la base es el depósito (`screening-seal-store.ts`).
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
  /**
   * La clave ya se comprobó contra lo cifrado de otra organización. La clave es una sola para
   * todo el sistema: con esto, una organización sin nada propio cifrado se sella igual.
   */
  keyVerified?: boolean
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
    if (keyCheck === 'no_sample' && !options.keyVerified) return { status: 'key_unverified' }

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

/** Una organización en el resumen del sistema: solo cantidades. */
export interface SealOverviewRow {
  organizationId: string
  rows: number
  plain: number
  foreignEnvelope: number
}

export type SealOutcome =
  | {
      status: 'done' | 'partial'
      /** Organizaciones donde se selló algo en este pedido. */
      organizations: number
      sealed: number
      batches: number
      remaining: number
      foreignEnvelope: number
      /** Organizaciones que se saltearon porque la clave no descifra lo que ya tienen cifrado. */
      keyMismatch: number
      /** Organizaciones que se saltearon porque no tienen nada cifrado contra qué comprobar la clave. */
      keyUnverified: number
    }
  | { status: 'no_key' }

export interface SealDeps {
  overview: () => Promise<SealOverviewRow[]>
  /** Textos ya cifrados de cualquier organización, para comprobar la clave una vez. */
  keySamples: () => Promise<string[]>
  storeFor: (orgId: string) => SealStore
  sealOrg?: typeof runOrgSeal
}

/**
 * Sella lo anterior al cifrado en **todas** las organizaciones, una por una, a nombre del
 * operador. Es obligación de quien responde por el sistema, no una opción de cada centro. El
 * tope de tiempo es uno solo para todo el pedido.
 *
 * La clave es la de la aplicación y es una sola: se comprueba una vez contra lo cifrado de
 * cualquier organización. Si lo propio de una organización está cifrado con otra clave, esa
 * se saltea y se informa, sin frenar a las demás.
 */
export async function runSeal(deps: SealDeps, options: Omit<OrgSealOptions, 'orgId'>): Promise<SealOutcome> {
  const now = options.now ?? Date.now
  const sealOrg = deps.sealOrg ?? runOrgSeal
  const checkKey = options.checkKey ?? checkKeyAgainstStored
  const probeKey = options.probeKey ?? (() => void sealScreeningJson({ probe: true }))
  const started = now()
  const pending = (await deps.overview()).filter((org) => org.plain > 0)

  let keyVerified = false
  if (pending.length > 0) {
    try {
      probeKey()
    } catch (err) {
      if (err instanceof PhiConfigError) return { status: 'no_key' }
      throw err
    }
    // Alcanza con que una muestra se descifre: lo que esté cifrado con otra clave lo detecta
    // la comprobación de su propia organización.
    keyVerified = (await deps.keySamples()).some((sample) => checkKey([sample]) === 'ok')
  }

  let organizations = 0
  let sealed = 0
  let batches = 0
  let keyMismatch = 0
  let keyUnverified = 0

  for (const org of pending) {
    const left = options.budgetMs - (now() - started)
    if (left <= 0) break
    const outcome = await sealOrg(deps.storeFor(org.organizationId), { ...options, orgId: org.organizationId, budgetMs: left, keyVerified })
    if (outcome.status === 'no_key') return { status: 'no_key' }
    if (outcome.status === 'key_mismatch') keyMismatch += 1
    else if (outcome.status === 'key_unverified') keyUnverified += 1
    else if (outcome.status === 'done' || outcome.status === 'partial') {
      sealed += outcome.sealed
      batches += outcome.batches
      if (outcome.sealed > 0) organizations += 1
    }
  }

  const after = await deps.overview()
  const remaining = after.reduce((total, org) => total + org.plain, 0)
  const foreignEnvelope = after.reduce((total, org) => total + org.foreignEnvelope, 0)
  return { status: remaining === 0 && foreignEnvelope === 0 ? 'done' : 'partial', organizations, sealed, batches, remaining, foreignEnvelope, keyMismatch, keyUnverified }
}
