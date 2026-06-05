interface DocumentsPageProps {
  params: Promise<{ id: string }>
}

export default async function StudyDocumentsPage({ params }: DocumentsPageProps) {
  const { id: studyId } = await params

  return (
    <section className="mx-auto max-w-3xl space-y-4">
      <h1 className="text-xl font-semibold">Documentos</h1>
      <p className="text-sm text-gray-500">Study ID: {studyId}</p>
      {/* TODO(paso-4/8): UploadZone + DocumentList + StatusBadge (polling de status). */}
    </section>
  )
}
