import { validateStudyAccess } from '@ichtys/auth'
import { db, eq } from '@ichtys/db'
import type { DocumentStatusItem } from '../../../../../components/documents/documents-status-list'

export const runtime = 'nodejs'

/**
 * GET /api/studies/[id]/documents — retorna el estado actual de todos los documentos
 * del estudio. Usado para polling desde el cliente (documents-status-list.tsx).
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id: studyId } = await params

  try {
    const { study, orgId } = await validateStudyAccess(studyId)

    const studyDocuments = await db.query.documents.findMany({
      where: (doc, { and }) => and(eq(doc.studyId, study.id), eq(doc.organizationId, orgId)),
      orderBy: (doc, { desc: descBy }) => [descBy(doc.createdAt)],
    })

    const versions = await db.query.documentVersions.findMany({
      where: (version, { and }) =>
        and(eq(version.studyId, study.id), eq(version.organizationId, orgId)),
      orderBy: (version, { desc: descBy }) => [
        descBy(version.versionNumber),
        descBy(version.createdAt),
      ],
    })

    const latestByDocumentId = new Map<string, (typeof versions)[number]>()
    for (const version of versions) {
      if (!latestByDocumentId.has(version.documentId)) {
        latestByDocumentId.set(version.documentId, version)
      }
    }

    const items: DocumentStatusItem[] = studyDocuments.map((doc) => {
      const latest = latestByDocumentId.get(doc.id)
      return {
        documentId: doc.id,
        documentName: doc.name,
        documentType: doc.documentType,
        latestVersionId: latest?.id ?? null,
        status: latest?.status ?? 'pending',
        pageCount: latest?.pageCount ?? null,
        errorMessage: latest?.errorMessage ?? null,
        createdAt: doc.createdAt.toISOString(),
      }
    })

    return Response.json(items)
  } catch {
    return new Response('Unauthorized', { status: 401 })
  }
}
