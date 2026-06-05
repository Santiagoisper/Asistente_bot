interface ChatPageProps {
  params: Promise<{ id: string }>
}

export default async function StudyChatPage({ params }: ChatPageProps) {
  const { id: studyId } = await params

  return (
    <section className="mx-auto flex h-full max-w-3xl flex-col">
      <h1 className="text-xl font-semibold">Chat del estudio</h1>
      <p className="text-sm text-gray-500">Study ID: {studyId}</p>
      {/* TODO(paso-8): ChatInterface (useChat → /api/chat) + CitationPanel.
          Toda respuesta lleva citas; sin evidencia → fallback explícito. */}
    </section>
  )
}
