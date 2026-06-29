import { auth } from '@clerk/nextjs/server'
import { and, db, eq, ingestionJobs, organizations } from '@ichtys/db'

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
  const { userId, orgId: clerkOrgId } = await auth()
  if (!userId || !clerkOrgId) return new Response('Unauthorized', { status: 401 })

  const org = await resolveOrg(clerkOrgId)
  if (!org) return new Response('Not Found', { status: 404 })

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
