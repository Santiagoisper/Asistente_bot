import { UploadZone } from '../../../../../components/documents/upload-zone'

interface DocumentsPageProps {
  params: Promise<{ id: string }>
}

export default async function StudyDocumentsPage({ params }: DocumentsPageProps) {
  const { id: studyId } = await params

  return (
    <section className="mx-auto max-w-3xl space-y-6">
      <h1 className="text-xl font-semibold">Documentos</h1>
      <UploadZone studyId={studyId} />
    </section>
  )
}
