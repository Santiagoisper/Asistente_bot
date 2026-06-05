interface HistoryPageProps {
  params: Promise<{ id: string }>
}

export default async function StudyHistoryPage({ params }: HistoryPageProps) {
  const { id: studyId } = await params

  return (
    <section className="mx-auto max-w-3xl space-y-4">
      <h1 className="text-xl font-semibold">Historial de conversaciones</h1>
      <p className="text-sm text-gray-500">Study ID: {studyId}</p>
      {/* TODO(paso-8): listar conversations del study (filtradas por org+study). */}
    </section>
  )
}
