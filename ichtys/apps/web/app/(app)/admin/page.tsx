import { auth } from '@clerk/nextjs/server'
import { db, eq, organizations, studies, documents, documentVersions, auditLogs } from '@ichtys/db'

function normalizeRole(orgRole: string | null | undefined): string {
  if (!orgRole) return 'read_only_monitor'
  const stripped = orgRole.replace(/^org:/, '')
  if (stripped === 'admin') return 'org_admin'
  return stripped
}

export default async function AdminPage() {
  const { orgId: clerkOrgId, orgRole } = await auth()
  const role = normalizeRole(orgRole)

  if (role !== 'org_admin' && role !== 'study_admin') {
    return (
      <section className="mx-auto max-w-3xl space-y-4">
        <h1 className="text-2xl font-semibold">Administración</h1>
        <p className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Acceso restringido a roles <code>org_admin</code> o <code>study_admin</code>.
        </p>
      </section>
    )
  }

  if (!clerkOrgId) {
    return (
      <section className="mx-auto max-w-3xl space-y-4">
        <h1 className="text-2xl font-semibold">Administración</h1>
        <p className="text-sm text-gray-600">No hay una organización activa en la sesión.</p>
      </section>
    )
  }

  const org = await db.query.organizations.findFirst({
    where: eq(organizations.clerkOrgId, clerkOrgId),
  })

  if (!org) {
    return (
      <section className="mx-auto max-w-3xl space-y-4">
        <h1 className="text-2xl font-semibold">Administración</h1>
        <p className="text-sm text-gray-600">No se encontró la organización en base de datos.</p>
      </section>
    )
  }

  const studyList = await db.query.studies.findMany({
    where: eq(studies.organizationId, org.id),
    orderBy: (s, { desc: descBy }) => [descBy(s.createdAt)],
  })

  const docs = await db.query.documents.findMany({
    where: eq(documents.organizationId, org.id),
    orderBy: (d, { desc: descBy }) => [descBy(d.createdAt)],
  })

  const versions = await db.query.documentVersions.findMany({
    where: eq(documentVersions.organizationId, org.id),
    orderBy: (v, { desc: descBy }) => [descBy(v.createdAt)],
  })

  const latestVersionByDocumentId = new Map<string, (typeof versions)[number]>()
  for (const version of versions) {
    if (!latestVersionByDocumentId.has(version.documentId)) {
      latestVersionByDocumentId.set(version.documentId, version)
    }
  }

  const recentAudit = await db.query.auditLogs.findMany({
    where: eq(auditLogs.organizationId, org.id),
    orderBy: (a, { desc: descBy }) => [descBy(a.createdAt)],
    limit: 50,
  })

  return (
    <section className="mx-auto max-w-5xl space-y-6">
      <h1 className="text-2xl font-semibold">Administración</h1>
      <p className="text-gray-600">
        Gestión de organización, estudios, documentos y usuarios. Restringido a
        roles <code>org_admin</code> / <code>study_admin</code>.
      </p>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-md border border-gray-200 bg-white p-4">
          <p className="text-xs uppercase tracking-wide text-gray-500">Estudios</p>
          <p className="mt-1 text-2xl font-semibold text-gray-900">{studyList.length}</p>
        </div>
        <div className="rounded-md border border-gray-200 bg-white p-4">
          <p className="text-xs uppercase tracking-wide text-gray-500">Documentos</p>
          <p className="mt-1 text-2xl font-semibold text-gray-900">{docs.length}</p>
        </div>
        <div className="rounded-md border border-gray-200 bg-white p-4">
          <p className="text-xs uppercase tracking-wide text-gray-500">Eventos de auditoría</p>
          <p className="mt-1 text-2xl font-semibold text-gray-900">{recentAudit.length}</p>
        </div>
      </div>

      <div className="rounded-md border border-gray-200 bg-white">
        <div className="border-b px-4 py-3">
          <h2 className="text-sm font-semibold text-gray-900">Estado documental por estudio</h2>
        </div>
        <div className="divide-y divide-gray-100">
          {studyList.map((study) => {
            const studyDocs = docs.filter((d) => d.studyId === study.id)
            const readyCount = studyDocs.filter((d) => latestVersionByDocumentId.get(d.id)?.status === 'ready').length
            const processingCount = studyDocs.filter((d) => latestVersionByDocumentId.get(d.id)?.status === 'processing').length
            const errorCount = studyDocs.filter((d) => latestVersionByDocumentId.get(d.id)?.status === 'error').length
            return (
              <div key={study.id} className="px-4 py-3 text-sm">
                <p className="font-medium text-gray-900">{study.name}</p>
                <p className="text-xs text-gray-500">
                  total: {studyDocs.length} · ready: {readyCount} · processing: {processingCount} · error: {errorCount}
                </p>
              </div>
            )
          })}
          {studyList.length === 0 ? (
            <p className="px-4 py-3 text-sm text-gray-500">No hay estudios creados en esta organización.</p>
          ) : null}
        </div>
      </div>

      <div className="rounded-md border border-gray-200 bg-white">
        <div className="border-b px-4 py-3">
          <h2 className="text-sm font-semibold text-gray-900">Auditoría reciente (read-only)</h2>
        </div>
        <div className="max-h-96 overflow-auto">
          <table className="min-w-full text-left text-xs">
            <thead className="sticky top-0 bg-gray-50 text-gray-600">
              <tr>
                <th className="px-3 py-2">Fecha</th>
                <th className="px-3 py-2">Acción</th>
                <th className="px-3 py-2">Recurso</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {recentAudit.map((entry) => (
                <tr key={entry.id}>
                  <td className="px-3 py-2">{entry.createdAt.toLocaleString('es-AR')}</td>
                  <td className="px-3 py-2">{entry.action}</td>
                  <td className="px-3 py-2">{entry.resourceType ?? '—'}:{entry.resourceId ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {recentAudit.length === 0 ? (
            <p className="px-4 py-3 text-sm text-gray-500">No hay eventos de auditoría para mostrar.</p>
          ) : null}
        </div>
      </div>
    </section>
  )
}
