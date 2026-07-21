import { NextResponse } from 'next/server'
import { z } from 'zod'
import { AccessError, validateStudyAccess } from '@ichtys/auth'
import { and, db, eq, inArray, studySpecs } from '@ichtys/db'
import { studySpecSchema } from '@ichtys/ingestion'
import { diffSpecs } from '../../../../../lib/spec-diff'

interface RouteParams {
  params: Promise<{ id: string }>
}

const querySchema = z.object({
  v1: z.string().uuid('v1 debe ser un UUID válido'),
  v2: z.string().uuid('v2 debe ser un UUID válido'),
})

/**
 * GET /api/studies/[id]/specs/diff?v1=<specId>&v2=<specId>
 *
 * Compara dos versiones del spec del mismo estudio.
 * v1 = versión "antigua" (base), v2 = versión "nueva" (head).
 *
 * Devuelve un SpecDiff: CriterionDiff[], EndpointDiff[], VisitDiff[],
 * más un summary { added, removed, modified } y hasChanges.
 */
export async function GET(req: Request, { params }: RouteParams) {
  const { id: studyId } = await params

  // Parse query params
  const url    = new URL(req.url)
  const parsed = querySchema.safeParse({
    v1: url.searchParams.get('v1'),
    v2: url.searchParams.get('v2'),
  })
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Parámetros inválidos', details: parsed.error.flatten() },
      { status: 400 },
    )
  }

  const { v1, v2 } = parsed.data
  if (v1 === v2) {
    return NextResponse.json({ error: 'v1 y v2 deben ser distintos' }, { status: 400 })
  }

  try {
    const { orgId } = await validateStudyAccess(studyId)

    // Fetch both spec rows — single query with tenant isolation enforced
    const rows = await db
      .select({ id: studySpecs.id, spec: studySpecs.spec, version: studySpecs.version })
      .from(studySpecs)
      .where(
        and(
          eq(studySpecs.organizationId, orgId),
          eq(studySpecs.studyId, studyId),
          inArray(studySpecs.id, [v1, v2]),
        ),
      )

    if (rows.length < 2) {
      return NextResponse.json(
        { error: 'Una o ambas versiones no existen en este estudio' },
        { status: 404 },
      )
    }

    const rowV1 = rows.find((r) => r.id === v1)!
    const rowV2 = rows.find((r) => r.id === v2)!

    // Validate both specs with Zod — protects against old jsonb shapes
    const specV1 = studySpecSchema.safeParse(rowV1.spec)
    const specV2 = studySpecSchema.safeParse(rowV2.spec)

    if (!specV1.success || !specV2.success) {
      return NextResponse.json(
        { error: 'Formato de spec no válido en una o ambas versiones' },
        { status: 422 },
      )
    }

    const diff = diffSpecs(specV1.data, specV2.data)

    return NextResponse.json({
      v1: { id: v1, version: rowV1.version },
      v2: { id: v2, version: rowV2.version },
      diff,
    })
  } catch (err) {
    if (err instanceof AccessError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: err.status })
    }
    console.error('[GET /api/studies/[id]/specs/diff]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
