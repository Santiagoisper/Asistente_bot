import { NextResponse } from 'next/server'
import { AccessError, validateStudyAccess } from '@ichtys/auth'
import { and, auditLogs, db, eq, ne, studySpecs } from '@ichtys/db'
import { studySpecSchema } from '@ichtys/ingestion/study-spec'
import { extractSpecTerminology } from '../../../../../../../lib/rag/spec-terminology'

interface RouteParams {
  params: Promise<{ id: string; specId: string }>
}

export async function POST(_req: Request, { params }: RouteParams) {
  const { id: studyId, specId } = await params

  try {
    const { userId, orgId } = await validateStudyAccess(studyId, 'study_admin')

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

      // Pre-computar terminología y persistirla en la columna dedicada (0004).
      let terminologyAnnotations: ReturnType<typeof extractSpecTerminology> | null = null
      try {
        const parsedSpec = studySpecSchema.safeParse(target.spec)
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
        },
      })
    })

    return NextResponse.json({ ok: true })
  } catch (err) {
    if (err instanceof AccessError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: err.status })
    }
    console.error('[POST /api/studies/[id]/spec/[specId]/approve]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
