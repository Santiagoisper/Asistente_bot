import { auth } from '@clerk/nextjs/server'
import { canAdministerStudy, loadAccessSubject, normalizeRole } from '@ichtys/auth'
import { allows } from '@ichtys/auth/functions'
import { and, db, eq, ingestionJobs, organizations } from '@ichtys/db'
import { z } from 'zod'

export const runtime = 'nodejs'

async function resolveOrg(clerkOrgId: string) {
  return db.query.organizations.findFirst({
    where: eq(organizations.clerkOrgId, clerkOrgId),
  })
}

/**
 * GET /api/studies/bulk-import/[batchId] — estado de un lote de importación.
 * Usado por la UI de bulk import para polling confiable vía ingestion_jobs.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ batchId: string }> },
): Promise<Response> {
  const { batchId } = await params
  const { userId, orgId: clerkOrgId, orgRole } = await auth()
  if (!userId || !clerkOrgId) return new Response('Unauthorized', { status: 401 })
  // Un identificador que no es UUID no llega a la base (antes: error 500 de Postgres).
  if (!z.string().uuid().safeParse(batchId).success) return new Response('Bad Request', { status: 400 })

  const org = await resolveOrg(clerkOrgId)
  if (!org) return new Response('Not Found', { status: 404 })
  // Mismo permiso que crear el lote (POST /api/studies/bulk-import): el estado
  // muestra nombres de archivo y estudios de toda la organización
  // (auditoría 19/11, H-02).
  const access = await loadAccessSubject({ org, userId, role: normalizeRole(orgRole) })
  if (!allows(access, 'study.create', canAdministerStudy)) return new Response('Forbidden', { status: 403 })

  const jobs = await db.query.ingestionJobs.findMany({
    where: and(eq(ingestionJobs.organizationId, org.id), eq(ingestionJobs.batchId, batchId)),
    orderBy: (j, { asc }) => [asc(j.createdAt)],
  })

  if (jobs.length === 0) return new Response('Not Found', { status: 404 })

  return Response.json({
    batchId,
    total: jobs.length,
    ready: jobs.filter((j) => j.status === 'ready').length,
    processing: jobs.filter((j) => j.status === 'processing' || j.status === 'pending').length,
    error: jobs.filter((j) => j.status === 'error').length,
    items: jobs.map((j) => ({
      jobId: j.id,
      fileName: j.fileName,
      studyId: j.studyId,
      documentId: j.documentId,
      documentVersionId: j.documentVersionId,
      status: j.status,
      error: j.errorMessage,
      attemptCount: j.attemptCount,
      maxAttempts: j.maxAttempts,
    })),
  })
}
