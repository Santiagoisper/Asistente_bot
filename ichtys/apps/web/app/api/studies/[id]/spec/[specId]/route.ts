import { NextResponse } from 'next/server'
import { AccessError, validateStudyAccess } from '@ichtys/auth'
import { and, db, eq, studySpecs } from '@ichtys/db'
import { studySpecSchema } from '@ichtys/ingestion'

interface RouteParams {
  params: Promise<{ id: string; specId: string }>
}

/**
 * PATCH /api/studies/[id]/spec/[specId]
 *
 * Replaces the spec jsonb of a *draft* study spec.
 * Used by spec-review.tsx for inline criterion editing.
 *
 * Body: { spec: StudySpec }
 * Returns: { ok: true }
 *
 * 400 — spec is not draft (already approved/superseded)
 * 400 — invalid spec shape
 * 401 — not authenticated / not study_admin
 * 500 — db error
 */
export async function PATCH(req: Request, { params }: RouteParams) {
  const { id: studyId, specId } = await params

  try {
    const { orgId } = await validateStudyAccess(studyId, 'study_admin')

    let body: unknown
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'Bad Request' }, { status: 400 })
    }

    const parsed = studySpecSchema.safeParse((body as Record<string, unknown>)?.spec)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid spec', issues: parsed.error.issues },
        { status: 400 },
      )
    }

    // Verify spec belongs to this tenant + study and is still draft
    const target = await db.query.studySpecs.findFirst({
      where: and(
        eq(studySpecs.id, specId),
        eq(studySpecs.organizationId, orgId),
        eq(studySpecs.studyId, studyId),
      ),
    })

    if (!target) throw new AccessError('Spec not found', 404)

    if (target.status !== 'draft') {
      return NextResponse.json(
        { error: 'Only draft specs can be edited' },
        { status: 400 },
      )
    }

    await db
      .update(studySpecs)
      .set({ spec: parsed.data, updatedAt: new Date() })
      .where(
        and(
          eq(studySpecs.id, specId),
          eq(studySpecs.organizationId, orgId),
          eq(studySpecs.studyId, studyId),
        ),
      )

    return NextResponse.json({ ok: true })
  } catch (err) {
    if (err instanceof AccessError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: err.status })
    }
    console.error('[PATCH /api/studies/[id]/spec/[specId]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
