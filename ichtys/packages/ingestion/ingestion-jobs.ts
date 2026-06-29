import { and, eq } from 'drizzle-orm'
import { db, ingestionJobs } from '@ichtys/db'
import { runIngestion } from './pipeline'

/**
 * ingestion-jobs.ts — worker para la cola persistida de bulk import.
 *
 * Cada job referencia un document_version creado por POST /api/studies/bulk-import.
 * El worker procesa en serie, reintenta hasta maxAttempts y persiste el estado
 * en ingestion_jobs (independiente del polling por document_versions.status).
 */

export async function runIngestionJobBatch(params: {
  batchId: string
  orgId: string
}): Promise<void> {
  const jobs = await db.query.ingestionJobs.findMany({
    where: and(
      eq(ingestionJobs.organizationId, params.orgId),
      eq(ingestionJobs.batchId, params.batchId),
    ),
    orderBy: (j, { asc }) => [asc(j.createdAt)],
  })

  for (const job of jobs) {
    if (job.status === 'ready' || job.status === 'error') continue
    await runSingleIngestionJob(job)
  }
}

/** Procesa un job individual (exportado para encolar after() por documento). */
export async function runSingleIngestionJobById(jobId: string, orgId: string): Promise<void> {
  const job = await db.query.ingestionJobs.findFirst({
    where: and(eq(ingestionJobs.id, jobId), eq(ingestionJobs.organizationId, orgId)),
  })
  if (!job || job.status === 'ready' || job.status === 'error') return
  await runSingleIngestionJob(job)
}

async function runSingleIngestionJob(
  job: typeof ingestionJobs.$inferSelect,
): Promise<void> {
  if (!job.studyId || !job.documentId || !job.documentVersionId) {
    await markJobFailed(job.id, 'Referencias de documento incompletas')
    return
  }

  let lastError: string | null = null

  for (let attempt = job.attemptCount; attempt < job.maxAttempts; attempt++) {
    await db
      .update(ingestionJobs)
      .set({
        status: 'processing',
        attemptCount: attempt + 1,
        startedAt: new Date(),
        updatedAt: new Date(),
        errorMessage: null,
      })
      .where(eq(ingestionJobs.id, job.id))

    try {
      await runIngestion({
        userId: job.userId,
        orgId: job.organizationId,
        studyId: job.studyId,
        documentId: job.documentId,
        documentVersionId: job.documentVersionId,
      })

      await db
        .update(ingestionJobs)
        .set({
          status: 'ready',
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(ingestionJobs.id, job.id))
      return
    } catch (err) {
      lastError = err instanceof Error ? err.message : 'Ingestion failed'
      console.error(`[ingestion-jobs] attempt ${attempt + 1} failed for job ${job.id}:`, err)
    }
  }

  await markJobFailed(job.id, lastError ?? 'Ingestion failed after retries')
}

async function markJobFailed(jobId: string, errorMessage: string): Promise<void> {
  await db
    .update(ingestionJobs)
    .set({
      status: 'error',
      errorMessage,
      completedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(ingestionJobs.id, jobId))
}
