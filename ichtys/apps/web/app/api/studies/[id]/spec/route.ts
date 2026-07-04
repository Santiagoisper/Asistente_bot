import { NextResponse } from 'next/server'
import { AccessError, validateStudyAccess } from '@ichtys/auth'
import { getLatestStudySpec, isMeaningfulSpec, specRichness, studySpecSchema } from '@ichtys/ingestion'
import { and, db, documents, documentVersions, eq } from '@ichtys/db'

interface RouteParams {
  params: Promise<{ id: string }>
}

export async function GET(req: Request, { params }: RouteParams) {
  const { id: studyId } = await params
  const summaryOnly = new URL(req.url).searchParams.get('summary') === '1'

  try {
    const { orgId } = await validateStudyAccess(studyId)

    if (summaryOnly) {
      const [specRow, protocolVersions] = await Promise.all([
        getLatestStudySpec({ orgId, studyId }),
        db
          .select({ status: documentVersions.status })
          .from(documents)
          .innerJoin(documentVersions, eq(documentVersions.documentId, documents.id))
          .where(
            and(
              eq(documents.studyId, studyId),
              eq(documents.organizationId, orgId),
              eq(documents.documentType, 'protocol'),
            ),
          ),
      ])

      const parsed = specRow ? studySpecSchema.safeParse(specRow.spec) : null
      const meaningful = parsed?.success ? isMeaningfulSpec(parsed.data) : false
      const protocolProcessing = protocolVersions.some(
        (v) => v.status === 'pending' || v.status === 'processing',
      )

      return NextResponse.json({
        version: specRow?.version ?? null,
        meaningful,
        richness: parsed?.success ? specRichness(parsed.data) : 0,
        protocolProcessing,
        status: specRow?.status ?? null,
      })
    }

    const spec = await getLatestStudySpec({ orgId, studyId })
    if (!spec) return NextResponse.json({ spec: null })
    return NextResponse.json({ spec })
  } catch (err) {
    if (err instanceof AccessError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: err.status })
    }
    console.error('[GET /api/studies/[id]/spec]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
