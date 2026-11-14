import { and, asc, dictationAudios, eq, evolutionVoids, isNull, unassignedDictationAudios } from '@ichtys/db'
import { insertAuditLog, type DbTransaction } from '../audit/audited-write'
import { findSubjectEvolution, type EvolutionScope } from './evolution-reader'
import type { VoidStore } from './evolution-void'
import { encryptClinicalContent } from './phi-fields'

/**
 * El `VoidStore` de verdad: todo dentro de la transacción que recibe, y todo acotado a la
 * organización, el estudio y el sujeto de quien llama (D24).
 */
export function txVoidStore(tx: DbTransaction, scope: EvolutionScope & { evolutionId: string }): VoidStore {
  return {
    // Con las anuladas, para poder decir «ya estaba anulada» en vez de «no existe».
    findEvolution: () => findSubjectEvolution(scope, 'with-voided', tx),

    insertVoid: async (row) => {
      const inserted = await tx
        .insert(evolutionVoids)
        .values({
          organizationId: scope.orgId,
          studyId: scope.studyId,
          subjectId: scope.subjectId,
          evolutionId: row.evolutionId,
          reason: row.reason,
          noteEncrypted: row.note === null ? null : encryptClinicalContent(row.note),
          declaredBy: row.declaredBy,
          declaredAt: row.declaredAt,
        })
        .onConflictDoNothing()
        .returning({ id: evolutionVoids.id })
      return inserted[0]?.id ?? null
    },

    audiosOf: () =>
      tx
        .select({
          id: dictationAudios.id,
          organizationId: dictationAudios.organizationId,
          studyId: dictationAudios.studyId,
          evolutionId: dictationAudios.evolutionId,
          take: dictationAudios.take,
          mime: dictationAudios.mime,
          sizeBytes: dictationAudios.sizeBytes,
          durationSec: dictationAudios.durationSec,
          sha256: dictationAudios.sha256,
          contentEncrypted: dictationAudios.contentEncrypted,
          segmentsEncrypted: dictationAudios.segmentsEncrypted,
          createdBy: dictationAudios.createdBy,
          createdAt: dictationAudios.createdAt,
          expiresAt: dictationAudios.expiresAt,
          purgedAt: dictationAudios.purgedAt,
        })
        .from(dictationAudios)
        .where(
          and(
            eq(dictationAudios.evolutionId, scope.evolutionId),
            eq(dictationAudios.organizationId, scope.orgId),
            eq(dictationAudios.studyId, scope.studyId),
            eq(dictationAudios.subjectId, scope.subjectId),
            isNull(dictationAudios.withdrawnAt),
          ),
        )
        .orderBy(asc(dictationAudios.take)),

    insertDeposit: async (row) => {
      const inserted = await tx.insert(unassignedDictationAudios).values(row).returning({ id: unassignedDictationAudios.id })
      const id = inserted[0]?.id
      if (!id) throw new Error('evolution_void_deposit_failed')
      return id
    },

    withdrawAudio: async (id, at) => {
      const updated = await tx
        .update(dictationAudios)
        .set({ contentEncrypted: null, segmentsEncrypted: null, withdrawnAt: at })
        .where(and(eq(dictationAudios.id, id), eq(dictationAudios.organizationId, scope.orgId), isNull(dictationAudios.withdrawnAt)))
        .returning({ id: dictationAudios.id })
      return updated.length === 1
    },

    audit: (entry) => insertAuditLog(tx, entry),
  }
}
