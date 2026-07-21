import { NextResponse } from 'next/server'
import { AccessError, validateStudyAccess } from '@ichtys/auth'
import { and, db, desc, eq, studySpecs } from '@ichtys/db'

interface RouteParams {
  params: Promise<{ id: string }>
}

/**
 * GET /api/studies/[id]/specs
 *
 * Lista todas las versiones del spec del estudio, ordenadas de más reciente
 * a más antigua. No incluye el jsonb completo — solo metadatos para el picker
 * de diff. El spec completo se obtiene via /api/studies/[id]/spec/[specId].
 */
export async function GET(_req: Request, { params }: RouteParams) {
  const { id: studyId } = await params

  try {
    const { orgId } = await validateStudyAccess(studyId)

    const rows = await db
      .select({
        id:             studySpecs.id,
        version:        studySpecs.version,
        status:         studySpecs.status,
        extractionModel: studySpecs.extractionModel,
        documentVersionId: studySpecs.documentVersionId,
        createdAt:      studySpecs.createdAt,
        updatedAt:      studySpecs.updatedAt,
      })
      .from(studySpecs)
      .where(
        and(
          eq(studySpecs.organizationId, orgId),
          eq(studySpecs.studyId, studyId),
        ),
      )
      .orderBy(desc(studySpecs.version))

    return NextResponse.json({ specs: rows })
  } catch (err) {
    if (err instanceof AccessError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: err.status })
    }
    console.error('[GET /api/studies/[id]/specs]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
