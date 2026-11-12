import { auditLogs, db } from '@ichtys/db'
import type { AuditLogParams } from '../chat/persistence'

/**
 * Escrituras auditadas (docs/compliance/REGULATORY-BASELINE.md, regla R3).
 *
 * El dato y su registro de auditoría se confirman juntos o no se confirma
 * ninguno. Antes, varias rutas guardaban el dato y recién después llamaban a
 * `writeAuditLog`: si esa segunda escritura fallaba, la respuesta era un error
 * pero el dato ya estaba guardado sin rastro de quién lo hizo.
 *
 * `writeAuditLog` sigue existiendo para lo que no modifica nada (registrar que
 * alguien vio o descargó algo): ahí el registro va antes de entregar el dato.
 */

/** La transacción en curso. Todo lo que una escritura auditada toca pasa por acá. */
export type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

/** `db` o una transacción: para servicios que pueden correr dentro de una escritura auditada. */
export type DbExecutor = DbTransaction | typeof db

export async function insertAuditLog(tx: DbTransaction, entry: AuditLogParams): Promise<void> {
  await tx.insert(auditLogs).values({
    action: entry.action,
    organizationId: entry.orgId,
    studyId: entry.studyId,
    userId: entry.userId,
    resourceType: entry.resourceType,
    resourceId: entry.resourceId,
    metadata: entry.metadata ?? null,
  })
}

/**
 * Corre `write` y registra `audit(resultado)` en la misma transacción. Si el
 * registro de auditoría falla, la escritura se revierte y el error sube tal
 * cual: quien llama responde con un error y no queda ningún dato sin rastro.
 */
export async function auditedWrite<T>(
  write: (tx: DbTransaction) => Promise<T>,
  audit: (result: T) => AuditLogParams,
): Promise<T> {
  return db.transaction(async (tx) => {
    const result = await write(tx)
    await insertAuditLog(tx, audit(result))
    return result
  })
}
