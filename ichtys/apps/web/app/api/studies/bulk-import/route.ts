import { after } from 'next/server'
import { auth, clerkClient } from '@clerk/nextjs/server'
import { auditLogs, db, documents, documentVersions, eq, ingestionJobs, organizations, studies } from '@ichtys/db'
import { runSingleIngestionJobById } from '@ichtys/ingestion/ingestion-jobs'
import { putPrivateDocumentPdf } from '../../documents/upload/blob-storage'
import {
  enforceSlidingWindowRateLimit,
  getUploadRateLimitConfig,
  rateLimitResponse,
} from '../../../../lib/security/rate-limit'
import { getOrCreateRequestId, log, makeRecord } from '../../../../lib/observability/logger'

export const runtime = 'nodejs'
export const maxDuration = 300

const MAX_PDF_BYTES = 50 * 1024 * 1024
const MAX_FILES_PER_BATCH = 25

function studyNameFromFileName(fileName: string): string {
  const base = fileName.replace(/\.pdf$/i, '').trim()
  const cleaned = base.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()
  return cleaned.length > 0 ? cleaned.slice(0, 200) : 'Protocolo importado'
}

function safeBlobFileName(fileName: string): string {
  const sanitized = fileName
    .trim()
    .replace(/[^A-Za-z0-9._-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[.-]+/, '')
  return sanitized.length > 0 ? sanitized : 'document.pdf'
}

function buildBlobKey(fileName: string): string {
  return `clinical-documents/${crypto.randomUUID()}/${safeBlobFileName(fileName)}`
}

async function resolveOrProvisionOrg(clerkOrgId: string) {
  const existing = await db.query.organizations.findFirst({
    where: eq(organizations.clerkOrgId, clerkOrgId),
  })
  if (existing) return existing

  let orgName = clerkOrgId
  try {
    const client = await clerkClient()
    const clerkOrg = await client.organizations.getOrganization({ organizationId: clerkOrgId })
    orgName = clerkOrg.name || clerkOrgId
  } catch {
    // Non-critical
  }

  const [provisioned] = await db
    .insert(organizations)
    .values({ clerkOrgId, name: orgName })
    .returning()

  if (!provisioned) throw new Error('Failed to provision organization')
  return provisioned
}

type BulkItemResult = {
  jobId: string | null
  fileName: string
  studyId: string | null
  documentId: string | null
  documentVersionId: string | null
  status: 'queued' | 'error'
  error: string | null
}

/**
 * POST /api/studies/bulk-import — crea un estudio por PDF, encola ingestion_jobs
 * y procesa el lote en background con reintentos persistidos.
 */
export async function POST(req: Request): Promise<Response> {
  const requestId = getOrCreateRequestId(req)
  log(makeRecord({ requestId, level: 'info', event: 'api.request.started', endpoint: '/api/studies/bulk-import', method: 'POST' }))

  const { userId, orgId: clerkOrgId } = await auth()
  if (!userId || !clerkOrgId) return new Response('Unauthorized', { status: 401 })

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return new Response('Bad Request', { status: 400 })
  }

  if (form.has('organization_id') || form.has('organizationId')) {
    return new Response('Bad Request', { status: 400 })
  }

  const files = form.getAll('files').filter((f): f is File => f instanceof File)
  if (files.length === 0) return new Response('Bad Request', { status: 400 })
  if (files.length > MAX_FILES_PER_BATCH) {
    return new Response(`Too many files (max ${MAX_FILES_PER_BATCH})`, { status: 413 })
  }

  const uploadRlConfig = getUploadRateLimitConfig()
  const rateLimit = await enforceSlidingWindowRateLimit({
    key: `bulk-import:${userId}:${clerkOrgId}`,
    limit: uploadRlConfig.limit,
    windowSeconds: uploadRlConfig.windowSeconds,
  })
  if (rateLimit.limited) return rateLimitResponse(rateLimit.retryAfterSeconds)

  let org: Awaited<ReturnType<typeof resolveOrProvisionOrg>>
  try {
    org = await resolveOrProvisionOrg(clerkOrgId)
  } catch {
    return new Response('Internal Server Error', { status: 500 })
  }

  const batchId = crypto.randomUUID()
  const results: BulkItemResult[] = []
  let queuedCount = 0

  for (const file of files) {
    const fileName = file.name.trim().length > 0 ? file.name : 'document.pdf'

    const isPdf =
      file.type === 'application/pdf' || fileName.toLowerCase().endsWith('.pdf')
    if (!isPdf) {
      const [errJob] = await db
        .insert(ingestionJobs)
        .values({
          organizationId: org.id,
          batchId,
          userId,
          fileName,
          status: 'error',
          errorMessage: 'Solo se procesan archivos PDF.',
          completedAt: new Date(),
        })
        .returning({ id: ingestionJobs.id })
      results.push({
        jobId: errJob?.id ?? null,
        fileName,
        studyId: null,
        documentId: null,
        documentVersionId: null,
        status: 'error',
        error: 'Solo se procesan archivos PDF.',
      })
      continue
    }
    if (file.size > MAX_PDF_BYTES) {
      const [errJob] = await db
        .insert(ingestionJobs)
        .values({
          organizationId: org.id,
          batchId,
          userId,
          fileName,
          status: 'error',
          errorMessage: 'El archivo supera el máximo de 50 MB.',
          completedAt: new Date(),
        })
        .returning({ id: ingestionJobs.id })
      results.push({
        jobId: errJob?.id ?? null,
        fileName,
        studyId: null,
        documentId: null,
        documentVersionId: null,
        status: 'error',
        error: 'El archivo supera el máximo de 50 MB.',
      })
      continue
    }

    try {
      const blobKey = buildBlobKey(fileName)
      const blob = await putPrivateDocumentPdf({ blobKey, file })

      const created = await db.transaction(async (tx) => {
        const [study] = await tx
          .insert(studies)
          .values({
            organizationId: org.id,
            name: studyNameFromFileName(fileName),
            status: 'active',
          })
          .returning()
        if (!study) throw new Error('Study insert did not return a row')

        const [document] = await tx
          .insert(documents)
          .values({
            organizationId: org.id,
            studyId: study.id,
            name: studyNameFromFileName(fileName),
            documentType: 'protocol',
          })
          .returning()
        if (!document) throw new Error('Document insert did not return a row')

        const [version] = await tx
          .insert(documentVersions)
          .values({
            documentId: document.id,
            organizationId: org.id,
            studyId: study.id,
            blobUrl: blob.url,
            blobKey: blob.pathname,
            fileSizeBytes: file.size,
            status: 'pending',
            versionNumber: 1,
          })
          .returning()
        if (!version) throw new Error('Document version insert did not return a row')

        const [job] = await tx
          .insert(ingestionJobs)
          .values({
            organizationId: org.id,
            batchId,
            userId,
            fileName,
            studyId: study.id,
            documentId: document.id,
            documentVersionId: version.id,
            status: 'pending',
          })
          .returning()
        if (!job) throw new Error('Ingestion job insert did not return a row')

        await tx.insert(auditLogs).values({
          organizationId: org.id,
          studyId: study.id,
          userId,
          action: 'document.upload',
          resourceType: 'document',
          resourceId: document.id,
          metadata: {
            documentVersionId: version.id,
            ingestionJobId: job.id,
            batchId,
            documentType: 'protocol',
            fileSizeBytes: file.size,
            fileName,
            bulk: true,
          },
        })

        return { study, document, version, job }
      })

      queuedCount++
      results.push({
        jobId: created.job.id,
        fileName,
        studyId: created.study.id,
        documentId: created.document.id,
        documentVersionId: created.version.id,
        status: 'queued',
        error: null,
      })
    } catch (err) {
      console.error('[bulk-import] item failed:', err)
      const [errJob] = await db
        .insert(ingestionJobs)
        .values({
          organizationId: org.id,
          batchId,
          userId,
          fileName,
          status: 'error',
          errorMessage: 'No se pudo registrar el documento.',
          completedAt: new Date(),
        })
        .returning({ id: ingestionJobs.id })
      results.push({
        jobId: errJob?.id ?? null,
        fileName,
        studyId: null,
        documentId: null,
        documentVersionId: null,
        status: 'error',
        error: 'No se pudo registrar el documento.',
      })
    }
  }

  if (queuedCount > 0) {
    // Un after() por job: cada protocolo tiene hasta maxDuration propio en Vercel
    // y la extracción de spec (4+ llamadas LLM) no compite con otros del lote.
    for (const item of results) {
      if (item.status !== 'queued' || !item.jobId) continue
      const jobId = item.jobId
      after(async () => {
        try {
          await runSingleIngestionJobById(jobId, org.id)
        } catch (err) {
          console.error(`[bulk-import] job ${jobId} error:`, err)
        }
      })
    }
  }

  log(makeRecord({ requestId, level: 'info', event: 'api.request.completed', endpoint: '/api/studies/bulk-import', method: 'POST', userId, statusCode: 202 }))

  return Response.json(
    { jobId: batchId, batchId, queued: queuedCount, total: files.length, items: results },
    { status: 202 },
  )
}
