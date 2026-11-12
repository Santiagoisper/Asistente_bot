import { ROLES, roleSatisfies, type Role } from '@ichtys/auth/roles'
import { allows } from '@ichtys/auth/functions'
import { studyScopeFilter, studyScopeOrOrgLevelFilter } from '@ichtys/auth/study-scope'
import { and, db, eq, studies, documents, documentVersions, auditLogs } from '@ichtys/db'
import { getOsContext } from '../../../lib/os/context'

/** Comprobación histórica: administrador del estudio o de la organización. */
const couldAdminister = (role: Role): boolean => roleSatisfies(role, ROLES.STUDY_ADMIN)

export default async function AdminPage() {
  const ctx = await getOsContext()

  if (!ctx) {
    return (
      <section className="mx-auto max-w-3xl space-y-4">
        <h1 className="text-2xl font-semibold text-alphi-navy">Administración</h1>
        <p className="text-sm text-alphi-muted">No hay una organización activa en la sesión.</p>
      </section>
    )
  }

  // Por rol en modo `open`; en modo estricto, por la capacidad de administrar
  // accesos de la organización (Dirección de Operaciones, administración de la
  // plataforma). Un Study Coordinator ya no entra solo por su rol histórico.
  if (!allows(ctx.access, 'access.manage_org', couldAdminister)) {
    return (
      <section className="mx-auto max-w-3xl space-y-4">
        <h1 className="text-2xl font-semibold text-alphi-navy">Administración</h1>
        <p className="rounded-md border border-alphi-amber/30 bg-alphi-amber/10 px-4 py-3 text-sm text-alphi-amber">
          No tenés permiso para ver la administración de la organización.
        </p>
      </section>
    )
  }

  // Listas y contadores respetan el alcance: quien administra la plataforma sin
  // ser parte de ningún estudio (M12) no ve estudios ni documentos, y del
  // registro de auditoría solo ve los eventos de la organización.
  const org = { id: ctx.orgId }
  const scope = ctx.studyScope

  const studyList = await db.query.studies.findMany({
    where: and(eq(studies.organizationId, org.id), studyScopeFilter(scope, studies.id)),
    orderBy: (s, { desc: descBy }) => [descBy(s.createdAt)],
  })

  const docs = await db.query.documents.findMany({
    where: and(eq(documents.organizationId, org.id), studyScopeFilter(scope, documents.studyId)),
    orderBy: (d, { desc: descBy }) => [descBy(d.createdAt)],
  })

  const versions = await db.query.documentVersions.findMany({
    where: and(eq(documentVersions.organizationId, org.id), studyScopeFilter(scope, documentVersions.studyId)),
    orderBy: (v, { desc: descBy }) => [descBy(v.createdAt)],
  })

  const latestVersionByDocumentId = new Map<string, (typeof versions)[number]>()
  for (const version of versions) {
    if (!latestVersionByDocumentId.has(version.documentId)) {
      latestVersionByDocumentId.set(version.documentId, version)
    }
  }

  const recentAudit = await db.query.auditLogs.findMany({
    where: and(
      eq(auditLogs.organizationId, org.id),
      studyScopeOrOrgLevelFilter(scope, auditLogs.studyId),
    ),
    orderBy: (a, { desc: descBy }) => [descBy(a.createdAt)],
    limit: 50,
  })

  return (
    <section className="mx-auto max-w-5xl space-y-6">
      <h1 className="text-2xl font-semibold text-alphi-navy">Administración</h1>
      <p className="text-alphi-muted">
        Gestión de organización, estudios, documentos y usuarios.
      </p>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="alphi-card p-4">
          <p className="text-xs uppercase tracking-wide text-alphi-muted">Estudios</p>
          <p className="mt-1 text-2xl font-semibold text-alphi-navy">{studyList.length}</p>
        </div>
        <div className="alphi-card p-4">
          <p className="text-xs uppercase tracking-wide text-alphi-muted">Documentos</p>
          <p className="mt-1 text-2xl font-semibold text-alphi-navy">{docs.length}</p>
        </div>
        <div className="alphi-card p-4">
          <p className="text-xs uppercase tracking-wide text-alphi-muted">Eventos de auditoría</p>
          <p className="mt-1 text-2xl font-semibold text-alphi-navy">{recentAudit.length}</p>
        </div>
      </div>

      <div className="alphi-card overflow-hidden">
        <div className="border-b border-alphi-border px-4 py-3">
          <h2 className="text-sm font-semibold text-alphi-navy">Estado documental por estudio</h2>
        </div>
        <div className="divide-y divide-alphi-border">
          {studyList.map((study) => {
            const studyDocs = docs.filter((d) => d.studyId === study.id)
            const readyCount = studyDocs.filter((d) => latestVersionByDocumentId.get(d.id)?.status === 'ready').length
            const processingCount = studyDocs.filter((d) => latestVersionByDocumentId.get(d.id)?.status === 'processing').length
            const errorCount = studyDocs.filter((d) => latestVersionByDocumentId.get(d.id)?.status === 'error').length
            return (
              <div key={study.id} className="px-4 py-3 text-sm">
                <p className="font-medium text-alphi-navy">{study.name}</p>
                <p className="text-xs text-alphi-muted">
                  total: {studyDocs.length} · listos: {readyCount} · procesando: {processingCount} · con error: {errorCount}
                </p>
              </div>
            )
          })}
          {studyList.length === 0 ? (
            <p className="px-4 py-3 text-sm text-alphi-muted">No hay estudios creados en esta organización.</p>
          ) : null}
        </div>
      </div>

      <div className="alphi-card overflow-hidden">
        <div className="border-b border-alphi-border px-4 py-3">
          <h2 className="text-sm font-semibold text-alphi-navy">Auditoría reciente (solo lectura)</h2>
        </div>
        <div className="max-h-96 overflow-x-auto overflow-y-auto">
          <table className="w-full min-w-[480px] table-fixed text-left text-xs">
            <colgroup>
              <col className="w-[30%]" />
              <col className="w-[30%]" />
              <col className="w-[40%]" />
            </colgroup>
            <thead className="sticky top-0 bg-alphi-slate text-alphi-muted">
              <tr>
                <th className="px-3 py-2">Fecha</th>
                <th className="px-3 py-2">Acción</th>
                <th className="px-3 py-2">Recurso</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-alphi-border bg-white">
              {recentAudit.map((entry) => (
                <tr key={entry.id}>
                  <td className="px-3 py-2 align-top text-alphi-navy">{entry.createdAt.toLocaleString('es-AR')}</td>
                  <td className="px-3 py-2 align-top text-alphi-navy break-words">{entry.action}</td>
                  <td className="px-3 py-2 align-top text-alphi-muted break-words">{entry.resourceType ?? '—'}:{entry.resourceId ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {recentAudit.length === 0 ? (
            <p className="px-4 py-3 text-sm text-alphi-muted">No hay eventos de auditoría para mostrar.</p>
          ) : null}
        </div>
      </div>
    </section>
  )
}
