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

/**
 * Lista cerrada de lo que este worker puede persistir. Sale de los códigos
 * propios de ingesta, embeddings, lectura de blob y del índice. Cualquier
 * otro valor, aunque tenga forma de código, se guarda como unknown_error.
 */
const KNOWN_INGESTION_FAILURE_CODES = new Set<string>([
  'blob_download_failed',
  'blob_not_found',
  'blob_private_read_failed',
  'embedding_config_missing',
  'embedding_dimension_mismatch',
  'embedding_internal_error',
  'embedding_provider_error',
  'embedding_rate_limited',
  'ingestion_internal_error',
  'pdf_complexity_limit',
  'pdf_contains_no_extractable_text',
  'pdf_text_extraction_failed',
  'spec_extraction_failed',
])

function ingestionFailureCode(err: unknown): string {
  if (err && typeof err === 'object' && 'code' in err) {
    const code = (err as { code: unknown }).code
    if (typeof code === 'string' && KNOWN_INGESTION_FAILURE_CODES.has(code)) return code
  }
  return 'unknown_error'
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
      lastError = ingestionFailureCode(err)
      console.error('[ingestion-jobs] attempt failed', {
        code: lastError,
        attempt: attempt + 1,
        jobId: job.id,
      })
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
