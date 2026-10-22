import { z } from 'zod'
import { handleApiError, validateDocumentAccess } from '@ichtys/auth'
import { and, count, db, eq, isNotNull } from '@ichtys/db'
import { chunks, pages } from '@ichtys/db'
import {
  deriveIngestionStage,
  describeIngestionErrorMessage,
  INGESTION_STAGE_LABELS,
} from '../../../../../lib/documents/ingestion-stage'

export const runtime = 'nodejs'

interface RouteContext {
  params: Promise<{ id: string }>
}

/**
 * GET /api/documents/[id]/status - ingestion pipeline status.
 */
export async function GET(_req: Request, { params }: RouteContext): Promise<Response> {
  const { id: documentId } = await params

  if (!z.string().uuid().safeParse(documentId).success) {
    return new Response('Bad Request', { status: 400 })
  }

  try {
    const { orgId, studyId, document } = await validateDocumentAccess(documentId)

    const latestVersion = await db.query.documentVersions.findFirst({
      where: (version, { and, eq }) =>
        and(
          eq(version.documentId, document.id),
          eq(version.organizationId, orgId),
          eq(version.studyId, studyId),
        ),
      orderBy: (version, { desc }) => [desc(version.versionNumber), desc(version.createdAt)],
    })

    if (!latestVersion) {
      throw new Error('Authorized document has no document version')
    }

    // Etapa real derivada de lo que el pipeline ya persistió (ver
    // lib/documents/ingestion-stage.ts): pages/chunks se insertan por etapa,
    // así que contándolos se sabe en qué paso está HOY.
    const [pagesRow, chunksTotalRow, chunksEmbeddedRow] = await Promise.all([
      db
        .select({ value: count() })
        .from(pages)
        .where(and(eq(pages.documentVersionId, latestVersion.id), eq(pages.organizationId, orgId))),
      db
        .select({ value: count() })
        .from(chunks)
        .where(
          and(eq(chunks.documentVersionId, latestVersion.id), eq(chunks.organizationId, orgId)),
        ),
      db
        .select({ value: count() })
        .from(chunks)
        .where(
          and(
            eq(chunks.documentVersionId, latestVersion.id),
            eq(chunks.organizationId, orgId),
            isNotNull(chunks.embedding),
          ),
        ),
    ])

    const stage = deriveIngestionStage({
      versionStatus: latestVersion.status,
      isProtocol: document.documentType === 'protocol',
      pagesCount: pagesRow[0]?.value ?? 0,
      chunksTotal: chunksTotalRow[0]?.value ?? 0,
      chunksEmbedded: chunksEmbeddedRow[0]?.value ?? 0,
    })

    // Mensaje de error: el código interno se mapea a texto claro en español —
    // nunca se devuelve crudo (podría filtrar detalles internos).
    const errorMessage =
      latestVersion.status === 'error'
        ? describeIngestionErrorMessage(latestVersion.errorMessage)
        : null

    return Response.json(
      {
        documentId: document.id,
        documentType: document.documentType,
        latestDocumentVersionId: latestVersion.id,
        status: latestVersion.status,
        stage,
        stageLabel: INGESTION_STAGE_LABELS[stage],
        pageCount: latestVersion.pageCount,
        pagesIndexed: pagesRow[0]?.value ?? 0,
        chunksTotal: chunksTotalRow[0]?.value ?? 0,
        chunksEmbedded: chunksEmbeddedRow[0]?.value ?? 0,
        errorMessage,
        createdAt: latestVersion.createdAt,
      },
      { status: 200 },
    )
  } catch (err) {
    return handleApiError(err)
  }
}
