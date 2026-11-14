/**
 * C3: lo que el sellado necesita de la base, **dentro de una organización**
 * (`screening-seal-run.ts` hace el recorrido). Toda consulta lleva la organización: quien
 * administra un centro no cuenta ni escribe filas de otro.
 *
 * Las condiciones son las mismas que usa `scripts/seal-screening-assessments.ts`, y eligen lo
 * mismo que `screeningColumnState`: un sobre es un objeto con `enc` y `ciphertext`.
 */
import { and, count, db, eq, patientProfiles, screeningAssessments, sql } from '@ichtys/db'
import { insertAuditLog } from '../audit/audited-write'
import type { SealStore } from './screening-seal-run'

const KEY_SAMPLES = 5
const cols = screeningAssessments

const assessmentsIsEnvelope = sql`(jsonb_typeof(${cols.assessments}) = 'object' AND jsonb_exists(${cols.assessments}, 'enc') AND jsonb_exists(${cols.assessments}, 'ciphertext'))`
const summaryIsEnvelope = sql`(jsonb_typeof(${cols.summary}) = 'object' AND jsonb_exists(${cols.summary}, 'enc') AND jsonb_exists(${cols.summary}, 'ciphertext'))`
const hasPlainColumn = sql`(NOT ${assessmentsIsEnvelope} OR NOT ${summaryIsEnvelope})`
const hasForeignEnvelope = sql`((${assessmentsIsEnvelope} AND ${cols.assessments}->>'enc' IS DISTINCT FROM 'phi.v1') OR (${summaryIsEnvelope} AND ${cols.summary}->>'enc' IS DISTINCT FROM 'phi.v1'))`
const assessmentsSealed = sql`(${assessmentsIsEnvelope} AND ${cols.assessments}->>'enc' = 'phi.v1')`

export function orgSealStore(orgId: string): SealStore {
  const inOrg = eq(cols.organizationId, orgId)
  const countWhere = async (where: ReturnType<typeof and>): Promise<number> => {
    const [row] = await db.select({ n: count() }).from(cols).where(where)
    return row?.n ?? 0
  }

  return {
    countRows: () => countWhere(inOrg),
    countPlain: () => countWhere(and(inOrg, hasPlainColumn)),
    countForeign: () => countWhere(and(inOrg, hasForeignEnvelope)),

    async keySamples() {
      const profiles = await db
        .select({ payload: patientProfiles.profileEncrypted })
        .from(patientProfiles)
        .where(eq(patientProfiles.organizationId, orgId))
        .limit(KEY_SAMPLES)
      const sealed = await db
        .select({ payload: sql<string>`${cols.assessments}->>'ciphertext'` })
        .from(cols)
        .where(and(inOrg, assessmentsSealed))
        .limit(KEY_SAMPLES)
      return [...profiles, ...sealed].map((sample) => sample.payload)
    },

    sealBatch(limit, plan, audit) {
      return db.transaction(async (tx) => {
        const rows = await tx
          .select({ id: cols.id, organizationId: cols.organizationId, assessments: cols.assessments, summary: cols.summary })
          .from(cols)
          .where(and(inOrg, hasPlainColumn))
          .orderBy(cols.id)
          .limit(limit)
          .for('update', { skipLocked: true })

        let written = 0
        for (const row of rows) {
          // Tira si lo sellado no vuelve igual: la transacción se revierte y la tanda no queda.
          const rowPlan = plan(row)
          if (Object.keys(rowPlan.set).length === 0) continue
          // Solo las columnas selladas, y solo en esta organización.
          await tx.update(cols).set(rowPlan.set).where(and(eq(cols.id, row.id), inOrg))
          written += 1
        }
        // Dato y registro en la misma transacción (R3).
        if (written > 0) await insertAuditLog(tx, audit(written))
        return written
      })
    },
  }
}
