import Link from 'next/link'
import { auth } from '@clerk/nextjs/server'
import { db, eq, organizations } from '@ichtys/db'

interface HistoryPageProps {
  params: Promise<{ id: string }>
}

export default async function StudyHistoryPage({ params }: HistoryPageProps) {
  const { id: studyId } = await params
  const { orgId: clerkOrgId, userId } = await auth()

  let items: Array<{
    id: string
    title: string | null
    updatedAt: Date
    createdAt: Date
  }> = []

  if (clerkOrgId && userId) {
    const org = await db.query.organizations.findFirst({
      where: eq(organizations.clerkOrgId, clerkOrgId),
    })
    if (org) {
      items = await db.query.conversations.findMany({
        where: (c, { and, eq }) => and(
          eq(c.organizationId, org.id),
          eq(c.studyId, studyId),
          eq(c.userId, userId),
        ),
        orderBy: (c, { desc }) => [desc(c.updatedAt)],
      })
    }
  }

  return (
    <section className="mx-auto max-w-3xl space-y-4">
      <h1 className="text-xl font-semibold">Historial de conversaciones</h1>
      <p className="text-sm text-gray-500">Study ID: {studyId}</p>
      {items.length === 0 ? (
        <div className="rounded-md border border-dashed border-gray-300 p-4 text-sm text-gray-500">
          No hay conversaciones previas para este estudio.
        </div>
      ) : (
        <ul className="divide-y divide-gray-100 rounded-md border border-gray-200 bg-white">
          {items.map((conversation) => (
            <li key={conversation.id}>
              <Link
                href={`/studies/${studyId}/chat?conversationId=${conversation.id}`}
                className="flex items-center justify-between px-4 py-3 hover:bg-gray-50"
              >
                <div>
                  <p className="text-sm font-medium text-gray-900">
                    {conversation.title ?? 'Conversación sin título'}
                  </p>
                  <p className="text-xs text-gray-500">
                    Actualizada: {conversation.updatedAt.toLocaleString('es-AR')}
                  </p>
                </div>
                <span className="text-xs text-gray-500">{conversation.id.slice(0, 8)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
