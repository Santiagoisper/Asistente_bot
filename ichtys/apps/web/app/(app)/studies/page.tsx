import Link from 'next/link'
import { auth } from '@clerk/nextjs/server'
import { resolveOrProvisionOrganization } from '@ichtys/auth'
import { db, eq, studies } from '@ichtys/db'
import { CreateStudyForm } from '../../../components/documents/create-study-form'

export default async function StudiesPage() {
  const { orgId: clerkOrgId } = await auth()
  let studyList: { id: string; name: string; protocolNumber: string | null; status: string; createdAt: Date }[] = []

  if (clerkOrgId) {
    const org = await resolveOrProvisionOrganization(clerkOrgId)
    if (org) {
      studyList = await db.query.studies.findMany({
        where: eq(studies.organizationId, org.id),
        orderBy: (s, ops) => [ops.desc(s.createdAt)],
      })
    }
  }

  const activeCount = studyList.filter((s) => s.status === 'active').length

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="alphi-label mb-1">Mis estudios</p>
          <h1 className="text-2xl font-bold text-alphi-navy">Estudios clinicos</h1>
          <p className="mt-1 text-sm text-alphi-muted">
            {activeCount} activo{activeCount !== 1 ? 's' : ''} &middot; {studyList.length} en total
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/library" className="alphi-btn-secondary text-sm">
            Librería
          </Link>
          <Link href="/studies/import" className="alphi-btn-secondary text-sm">
            Importar varios
          </Link>
          <CreateStudyForm />
        </div>
      </div>

      {studyList.length === 0 ? (
        <div className="alphi-card flex flex-col items-center justify-center gap-4 py-16 text-center">
          <div>
            <p className="text-base font-bold text-alphi-navy">Sin estudios todavia</p>
            <p className="mt-1 max-w-xs text-sm text-alphi-muted">
              Crea tu primer estudio, subi el protocolo y empieza a consultar.
            </p>
          </div>
          <CreateStudyForm />
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {studyList.map((study) => (
            <Link
              key={study.id}
              href={`/studies/${study.id}/chat`}
              className="alphi-card group flex flex-col gap-3 p-5 transition-all duration-150 hover:border-alphi-teal/40 hover:shadow-alphi-panel"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-base font-bold text-alphi-navy transition-colors group-hover:text-alphi-teal">
                    {study.name}
                  </p>
                  {study.protocolNumber && (
                    <p className="mt-0.5 font-mono text-xs text-alphi-muted">{study.protocolNumber}</p>
                  )}
                </div>
                <span className={[
                  'alphi-pill shrink-0',
                  study.status === 'active'
                    ? 'border-alphi-sage/30 bg-alphi-sage/10 text-alphi-sage'
                    : 'border-alphi-border bg-alphi-slate text-alphi-muted',
                ].join(' ')}>
                  {study.status === 'active' ? 'Activo' : study.status}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <p className="text-xs text-alphi-muted">
                  {new Date(study.createdAt).toLocaleDateString('es', { day: '2-digit', month: 'short', year: 'numeric' })}
                </p>
                <span className="text-xs font-semibold text-alphi-teal opacity-0 transition-opacity group-hover:opacity-100">
                  Consultar &rarr;
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
