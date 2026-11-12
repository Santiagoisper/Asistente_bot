import { NextResponse } from 'next/server'
import { AccessError, validateStudyAccess } from '@ichtys/auth'
import { and, auditLogs, db, eq, ne, studySpecs } from '@ichtys/db'
import {
  groupsNeedingAcknowledgement,
  studySpecSchema,
  type SpecGroupName,
} from '@ichtys/ingestion/study-spec'
import { JsonBodyTooLargeError, readJsonBody } from '../../../../../../../lib/api/body-limit'
import { extractSpecTerminology } from '../../../../../../../lib/rag/spec-terminology'

interface RouteParams {
  params: Promise<{ id: string; specId: string }>
}

/** La spec tiene grupos parciales que no se reconocieron en el cuerpo. */
class SpecIncompleteError extends Error {
  constructor(readonly groups: SpecGroupName[]) {
    super('Spec incomplete')
    this.name = 'SpecIncompleteError'
  }
}

export async function POST(req: Request, { params }: RouteParams) {
  const { id: studyId, specId } = await params

  try {
    const { userId, orgId } = await validateStudyAccess(studyId, 'study_admin', 'documents.manage')

    // Cuerpo opcional: { acknowledgeGroups: ['eligibility', …] }. Sin cuerpo
    // se aprueba sólo una spec completa (ADR-3 §2.4).
    let body: unknown
    try {
      body = await readJsonBody(req, { allowEmpty: true })
    } catch (err) {
      if (err instanceof JsonBodyTooLargeError) {
        return NextResponse.json({ error: 'Request body too large' }, { status: 413 })
      }
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }
    const acknowledged = new Set<string>()
    if (typeof body === 'object' && body !== null) {
      const raw = (body as Record<string, unknown>).acknowledgeGroups
      if (Array.isArray(raw)) {
        for (const group of raw) {
          if (typeof group === 'string') acknowledged.add(group)
        }
      }
    }

    await db.transaction(async (tx) => {
      const target = await tx.query.studySpecs.findFirst({
        where: and(
          eq(studySpecs.id, specId),
          eq(studySpecs.organizationId, orgId),
          eq(studySpecs.studyId, studyId),
        ),
      })

      if (!target) throw new AccessError('Spec not found', 404)
      if (target.status === 'approved') {
        return
      }

      const parsedSpec = studySpecSchema.safeParse(target.spec)
      const partialGroups = parsedSpec.success
        ? groupsNeedingAcknowledgement(parsedSpec.data)
        : []
      const missing = partialGroups.filter((group) => !acknowledged.has(group))
      if (missing.length > 0) throw new SpecIncompleteError(missing)

      // Pre-computar terminología y persistirla en la columna dedicada (0004).
      let terminologyAnnotations: ReturnType<typeof extractSpecTerminology> | null = null
      try {
        if (parsedSpec.success) {
          terminologyAnnotations = extractSpecTerminology(parsedSpec.data)
        }
      } catch {
        // Non-critical: aprobar igual sin terminología.
      }

      await tx
        .update(studySpecs)
        .set({
          status: 'approved',
          terminologyAnnotations,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(studySpecs.id, specId),
            eq(studySpecs.organizationId, orgId),
            eq(studySpecs.studyId, studyId),
          ),
        )

      await tx
        .update(studySpecs)
        .set({ status: 'superseded', updatedAt: new Date() })
        .where(
          and(
            ne(studySpecs.id, specId),
            eq(studySpecs.organizationId, orgId),
            eq(studySpecs.studyId, studyId),
            ne(studySpecs.status, 'superseded'),
          ),
        )

      await tx.insert(auditLogs).values({
        organizationId: orgId,
        studyId,
        userId,
        action: 'study_spec.approved',
        resourceType: 'study_spec',
        resourceId: specId,
        metadata: {
          version: target.version,
          terminologyCount: terminologyAnnotations?.length ?? 0,
          ...(partialGroups.length > 0 ? { acknowledgedGroups: partialGroups } : {}),
        },
      })
    })

    return NextResponse.json({ ok: true })
  } catch (err) {
    if (err instanceof SpecIncompleteError) {
      return NextResponse.json(
        { error: 'spec_incomplete', groups: err.groups },
        { status: 409 },
      )
    }
    if (err instanceof AccessError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: err.status })
    }
    console.error('[POST /api/studies/[id]/spec/[specId]/approve]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
