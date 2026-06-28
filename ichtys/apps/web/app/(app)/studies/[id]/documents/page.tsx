import { validateStudyAccess } from '@ichtys/auth'
import { db, eq } from '@ichtys/db'
import { UploadZone } from '../../../../../components/documents/upload-zone'
import { DocumentsStatusList, type DocumentStatusItem } from '../../../../../components/documents/documents-status-list'

interface DocumentsPageProps {
  params: Promise<{ id: string }>
}

export default async function StudyDocumentsPage({ params }: DocumentsPageProps) {
  const { id: studyId } = await params
  const { study, orgId } = await validateStudyAccess(studyId)

  const studyDocuments = await db.query.documents.findMany({
    where: (doc, { and }) => and(eq(doc.studyId, study.id), eq(doc.organizationId, orgId)),
    orderBy: (doc, { desc: descBy }) => [descBy(doc.createdAt)],
  })
  const versions = await db.query.documentVersions.findMany({
    where: (version, { and }) => and(eq(version.studyId, study.id), eq(version.organizationId, orgId)),
    orderBy: (version, { desc: descBy }) => [descBy(version.versionNumber), descBy(version.createdAt)],
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

  return (
    <section className="mx-auto max-w-3xl space-y-6">
      <h1 className="text-xl font-semibold">Documentos</h1>
      <UploadZone studyId={studyId} />
      <DocumentsStatusList items={items} studyId={studyId} />
    </section>
  )
}
