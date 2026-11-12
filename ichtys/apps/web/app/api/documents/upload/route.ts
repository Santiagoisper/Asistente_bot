import { z } from 'zod'
import { AccessError, canManageDocuments, handleApiError, validateStudyAccess } from '@ichtys/auth'
import { allows } from '@ichtys/auth/functions'
import { auditLogs, db, documents, documentVersions } from '@ichtys/db'
import { putPrivateDocumentPdf } from './blob-storage'
import {
  enforceSlidingWindowRateLimit,
  getUploadRateLimitConfig,
  rateLimitResponse,
  rateLimitUnavailableResponse,
} from '../../../../lib/security/rate-limit'
import { getOrCreateRequestId, log, makeRecord } from '../../../../lib/observability/logger'
import { uploadMetaInput as uploadMeta } from '../../../../lib/api/input-schemas'
import { MAX_UPLOAD_BODY_BYTES, validatePdfUpload } from '../../../../lib/documents/pdf-upload-validation'

export const runtime = 'nodejs'

function getOptionalString(form: FormData, key: string): string | undefined {
  const value = form.get(key)
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}

function getRequiredString(form: FormData, key: string): string | null {
  const value = form.get(key)
  return typeof value === 'string' ? value : null
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

/**
 * Content-Length por encima del tope, o un valor que no es un entero seguro,
 * se rechaza sin leer. Un número chico no se cree: el stream se mide aparte.
 */
function declaredBodyTooLarge(req: Request): boolean {
  const raw = req.headers.get('content-length')
  if (raw === null) return false
  if (!/^\d+$/.test(raw)) return true
  const size = Number(raw)
  return !Number.isSafeInteger(size) || size > MAX_UPLOAD_BODY_BYTES
}

/**
 * Lee el multipart contando bytes reales y cancela el stream al pasar el tope.
 * Recién entonces se parsea. Un Content-Length falso y chico no abre el cuerpo.
 */
async function formDataWithinCap(req: Request): Promise<FormData | 'too_large'> {
  if (declaredBodyTooLarge(req)) return 'too_large'
  if (req.body === null) return req.formData()

  const reader = req.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (!value || value.byteLength === 0) continue
    if (total + value.byteLength > MAX_UPLOAD_BODY_BYTES) {
      await reader.cancel().catch(() => undefined)
      return 'too_large'
    }
    chunks.push(value)
    total += value.byteLength
  }

  const body = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  const headers = new Headers(req.headers)
  headers.set('content-length', String(total))
  return new Request(req.url, { method: 'POST', headers, body }).formData()
}

/**
 * POST /api/documents/upload — el estudio viaja en la query para poder
 * autenticar y autorizar (acceso y rol) antes de tocar el archivo. El cuerpo
 * se lee con tope de bytes reales; al superarlo se cancela y se responde 413.
 * La validación por archivo (MIME, firma, 50 MiB) se mantiene.
 */
export async function POST(req: Request): Promise<Response> {
  const requestId = getOrCreateRequestId(req)
  const startMs = Date.now()
  log(makeRecord({ requestId, level: 'info', event: 'api.request.started', endpoint: '/api/documents/upload', method: 'POST' }))

  try {
    const url = new URL(req.url)
    if (url.searchParams.has('organization_id') || url.searchParams.has('organizationId')) {
      return new Response('Bad Request', { status: 400 })
    }

    const studyId = z.string().uuid().safeParse(url.searchParams.get('studyId'))
    if (!studyId.success) {
      return new Response('Bad Request', { status: 400 })
    }

    const access = await validateStudyAccess(studyId.data)
    if (!allows(access.access, 'documents.manage', canManageDocuments)) {
      throw new AccessError('Forbidden', 403)
    }
    const { userId, orgId, study } = access

    let form: FormData
    try {
      const loaded = await formDataWithinCap(req)
      if (loaded === 'too_large') {
        return new Response('Payload Too Large', { status: 413 })
      }
      form = loaded
    } catch {
      return new Response('Bad Request', { status: 400 })
    }

    if (form.has('organization_id') || form.has('organizationId')) {
      return new Response('Bad Request', { status: 400 })
    }

    const formStudyId = getRequiredString(form, 'studyId')
    if (formStudyId !== studyId.data) {
      return new Response('Bad Request', { status: 400 })
    }

    const file = form.get('file')
    const meta = uploadMeta.safeParse({
      studyId: formStudyId,
      name: getOptionalString(form, 'name'),
      documentType: getRequiredString(form, 'documentType'),
    })

    if (!meta.success || !(file instanceof File)) {
      return new Response('Bad Request', { status: 400 })
    }

    const pdfVerdict = await validatePdfUpload(file)
    if (pdfVerdict === 'too_large') {
      return new Response('Payload Too Large', { status: 413 })
    }
    if (pdfVerdict !== 'ok') {
      return new Response('Unsupported Media Type', { status: 415 })
    }

    const uploadRlConfig = getUploadRateLimitConfig()
    const rateLimit = await enforceSlidingWindowRateLimit({
      key: `upload:${orgId}:${userId}`,
      limit: uploadRlConfig.limit,
      windowSeconds: uploadRlConfig.windowSeconds,
      orgKey: `upload-org:${orgId}`,
      orgLimit: uploadRlConfig.orgLimit,
    })
    if (rateLimit.limited) {
      if (rateLimit.reason === 'unavailable') {
        log(makeRecord({ requestId, level: 'warn', event: 'api.rate_limit.blocked', endpoint: '/api/documents/upload', method: 'POST', userId, studyId: meta.data.studyId, statusCode: 503 }))
        return rateLimitUnavailableResponse()
      }
      log(makeRecord({ requestId, level: 'warn', event: 'api.rate_limit.blocked', endpoint: '/api/documents/upload', method: 'POST', userId, studyId: meta.data.studyId, statusCode: 429 }))
      return rateLimitResponse(rateLimit.retryAfterSeconds)
    }

    const fileName = file.name.trim().length > 0 ? file.name : 'document.pdf'
    const name = meta.data.name ?? fileName
    const blobKey = buildBlobKey(fileName)
    // P1-6: el guardado en almacenamiento es la unica dependencia externa de
    // esta ruta. Su fallo se reporta como 502 (storage no disponible) con un
    // mensaje claro, no como el 500 generico de handleApiError.
    const blob = await putPrivateDocumentPdf({ blobKey, file }).catch((err: unknown) => {
      log(makeRecord({
        requestId,
        level: 'error',
        event: 'api.request.failed',
        endpoint: '/api/documents/upload',
        method: 'POST',
        userId,
        studyId: meta.data.studyId,
        statusCode: 502,
        errorCode: 'blob_storage_unavailable',
        durationMs: Date.now() - startMs,
      }))
      // Solo el nombre del error: el mensaje del SDK incluye la URL del blob,
      // que contiene el nombre del archivo subido (posible PHI).
      console.error(
        '[documents/upload] no se pudo guardar el PDF en el almacenamiento:',
        err instanceof Error ? err.name : 'unknown',
      )
      return null
    })

    if (!blob) {
      return new Response(
        'No se pudo guardar el archivo en el almacenamiento. Intentá de nuevo en unos segundos.',
        { status: 502, headers: { 'Content-Type': 'text/plain; charset=utf-8' } },
      )
    }

    const result = await db.transaction(async (tx) => {
      const [document] = await tx
        .insert(documents)
        .values({
          organizationId: orgId,
          studyId: study.id,
          name,
          documentType: meta.data.documentType,
        })
        .returning()

      if (!document) {
        throw new Error('Document insert did not return a row')
      }

      // TODO(re-upload): compute max(version_number) + 1 for existing logical
      // documents once the UI supports uploading a new version of the same doc.
      const versionNumber = 1
      const [documentVersion] = await tx
        .insert(documentVersions)
        .values({
          documentId: document.id,
          organizationId: orgId,
          studyId: study.id,
          blobUrl: blob.url,
          blobKey: blob.pathname,
          fileSizeBytes: file.size,
          status: 'pending',
          versionNumber,
        })
        .returning()

      if (!documentVersion) {
        throw new Error('Document version insert did not return a row')
      }

      await tx.insert(auditLogs).values({
        organizationId: orgId,
        studyId: study.id,
        userId,
        action: 'document.upload',
        resourceType: 'document',
        resourceId: document.id,
        metadata: {
          documentVersionId: documentVersion.id,
          documentType: meta.data.documentType,
          fileSizeBytes: file.size,
          fileName,
        },
      })

      return { document, documentVersion }
    })

    log(makeRecord({ requestId, level: 'info', event: 'api.request.completed', endpoint: '/api/documents/upload', method: 'POST', userId, studyId: meta.data.studyId, documentId: result.document.id, documentVersionId: result.documentVersion.id, statusCode: 202, durationMs: Date.now() - startMs }))
    return Response.json(
      {
        documentId: result.document.id,
        documentVersionId: result.documentVersion.id,
        status: result.documentVersion.status,
        name: result.document.name,
        documentType: result.document.documentType,
      },
      { status: 202 },
    )
  } catch (err) {
    log(makeRecord({ requestId, level: 'error', event: 'api.request.failed', endpoint: '/api/documents/upload', method: 'POST', durationMs: Date.now() - startMs }))
    return handleApiError(err)
  }
}
