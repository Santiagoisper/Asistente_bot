import { NextResponse } from 'next/server'
import { AccessError, validateStudyAccess } from '@ichtys/auth'
import { and, auditLogs, db, eq, ne, studySpecs } from '@ichtys/db'

interface RouteParams {
  params: Promise<{ id: string; specId: string }>
}

export async function POST(_req: Request, { params }: RouteParams) {
  const { id: studyId, specId } = await params

  try {
    const { userId, orgId } = await validateStudyAccess(studyId, 'study_admin')

    await db.transaction(async (tx) => {
      // Verificar que el spec pertenece a este tenant y estudio
      const target = await tx.query.studySpecs.findFirst({
        where: and(
          eq(studySpecs.id, specId),
          eq(studySpecs.organizationId, orgId),
          eq(studySpecs.studyId, studyId),
        ),
      })

      if (!target) throw new AccessError('Spec not found', 404)
      if (target.status === 'approved') {
        return // idempotente
      }

      // Aprobar este spec
      await tx
        .update(studySpecs)
        .set({ status: 'approved', updatedAt: new Date() })
        .where(
          and(
            eq(studySpecs.id, specId),
            eq(studySpecs.organizationId, orgId),
            eq(studySpecs.studyId, studyId),
          ),
        )

      // Superseder versiones anteriores aprobadas o draft (todas las demás)
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
        metadata: { version: target.version },
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
