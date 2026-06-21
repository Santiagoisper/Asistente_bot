import Link from 'next/link'
import { auth } from '@clerk/nextjs/server'
import { db, eq, organizations, studies } from '@ichtys/db'
import { CreateStudyForm } from '../../../components/documents/create-study-form'

export default async function StudiesPage() {
  const { orgId: clerkOrgId } = await auth()

  let studyList: { id: string; name: string; protocolNumber: string | null; status: string; createdAt: Date }[] = []

  if (clerkOrgId) {
    const org = await db.query.organizations.findFirst({
      where: eq(organizations.clerkOrgId, clerkOrgId),
    })
    if (org) {
      studyList = await db.query.studies.findMany({
        where: eq(studies.organizationId, org.id),
        orderBy: (s, { desc }) => [desc(s.createdAt)],
      })
    }
  }

  return (
    <section className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Estudios</h1>
        <CreateStudyForm />
      </div>

      {studyList.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 px-6 py-12 text-center">
          <p className="text-sm text-gray-500">
            No hay estudios todavía. Creá el primero para empezar a subir documentos.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white">
          {studyList.map((study) => (
            <li key={study.id}>
              <Link
                href={`/studies/${study.id}/documents`}
                className="flex items-center justify-between px-4 py-3 hover:bg-gray-50"
              >
                <div>
                  <p className="text-sm font-medium text-gray-900">{study.name}</p>
                  {study.protocolNumber && (
                    <p className="text-xs text-gray-500">{study.protocolNumber}</p>
                  )}
                </div>
                <span
                  className={[
                    'rounded-full px-2 py-0.5 text-xs font-medium',
                    study.status === 'active'
                      ? 'bg-green-100 text-green-700'
                      : 'bg-gray-100 text-gray-500',
                  ].join(' ')}
                >
                  {study.status === 'active' ? 'Activo' : study.status}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
