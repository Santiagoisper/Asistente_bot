import { NextResponse } from 'next/server'
import { AccessError, validateStudyAccess } from '@ichtys/auth'
import { getLatestStudySpec } from '@ichtys/ingestion'

interface RouteParams {
  params: Promise<{ id: string }>
}

export async function GET(_req: Request, { params }: RouteParams) {
  const { id: studyId } = await params

  try {
    const { orgId } = await validateStudyAccess(studyId)
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
