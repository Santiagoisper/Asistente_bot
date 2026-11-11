import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ButtonLink, Card, EmptyState, LoadError, PageHeader } from '../../../components/os/ui'
import { isOsEnabled } from '../../../lib/flags'
import { getOsContext } from '../../../lib/os/context'
import { sinceLabel } from '../../../lib/os/greeting'
import {
  listPendingLabReports,
  listPendingLabReviews,
  type PendingLabReportRow,
  type PendingLabReviewRow,
} from '../../../lib/os/inicio-data'

export const dynamic = 'force-dynamic'

const MAX_ROWS = 200

export default async function LaboratoriosPage() {
  if (!isOsEnabled()) notFound()
  const ctx = await getOsContext()
  const header = (
    <PageHeader
      title="Laboratorios"
      subtitle="Resultados que esperan que una persona los confirme mirando el estudio original."
      action={<ButtonLink href="/laboratorios/cargar" variant="solid">Cargar estudio</ButtonLink>}
    />
  )

  if (!ctx) {
    return (
      <div className="mx-auto flex max-w-5xl flex-col gap-5">
        {header}
        <EmptyState title="Elegí una organización" detail="Para ver los laboratorios necesitás tener una organización activa." />
      </div>
    )
  }
  if (!ctx.canSeeSubjects) {
    return (
      <div className="mx-auto flex max-w-5xl flex-col gap-5">
        {header}
        <EmptyState title="Sin acceso" detail="Tu rol no tiene acceso a datos de sujetos. Pedile a un administrador del estudio si lo necesitás." />
      </div>
    )
  }

  const now = new Date()
  let rows: PendingLabReviewRow[]
  let reports: PendingLabReportRow[]
  try {
    const loaded = await Promise.all([
      listPendingLabReviews(ctx.orgId, MAX_ROWS),
      listPendingLabReports(ctx.orgId, MAX_ROWS),
    ])
    rows = loaded[0]
    reports = loaded[1]
  } catch {
    // Caso típico: la migración 0011 todavía no se aplicó en esta base.
    console.error('[os/laboratorios] pending list failed')
    return (
      <div className="mx-auto flex max-w-5xl flex-col gap-5">
        {header}
        <LoadError what="la lista de laboratorios pendientes" />
      </div>
    )
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5">
      {header}
      <Card
        labelledBy="informes-pendientes"
        title="Estudios subidos por revisar"
        subtitle={reports.length === 0 ? undefined : 'Cada estudio se revisa contra el texto del informe antes de confirmar.'}
      >
        {reports.length === 0 ? (
          <EmptyState
            title="Ningún estudio esperando revisión"
            detail="Subí el PDF de un laboratorio y el programa propone los campos para que los revises."
            action={<ButtonLink href="/laboratorios/cargar" variant="solid">Cargar estudio</ButtonLink>}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] border-collapse text-sm">
              <thead>
                <tr className="text-left text-xs text-os-subtle">
                  <th scope="col" className="px-3 py-2 font-semibold">Sujeto</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Estudio</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Campos</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Espera</th>
                  <th scope="col" className="px-3 py-2 font-semibold"><span className="sr-only">Acción</span></th>
                </tr>
              </thead>
              <tbody>
                {reports.map((report) => (
                  <tr key={report.reportId} className="border-t border-alphi-border">
                    <td className="px-3 py-3 font-semibold text-os-ink">{report.subjectCode}</td>
                    <td className="px-3 py-3 text-os-ink">{report.studyLabel}</td>
                    <td className="px-3 py-3 text-os-subtle">{report.rowCount}</td>
                    <td className="px-3 py-3 text-os-subtle">{sinceLabel(report.since, now)}</td>
                    <td className="px-3 py-3 text-right">
                      <Link
                        href={`/studies/${report.studyId}/subjects/${report.subjectId}/labs/${report.reportId}`}
                        className="inline-flex min-h-11 items-center rounded-lg bg-os-accent px-4 text-sm font-semibold text-white hover:bg-os-accentdim focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-os-accent"
                      >
                        Revisar
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Card
        labelledBy="labs-pendientes"
        title="Revisiones pendientes en fichas de sujetos"
        subtitle={rows.length === 0 ? undefined : `${rows.length} ${rows.length === 1 ? 'sujeto' : 'sujetos'} con revisión abierta. No se muestran valores en esta lista.`}
      >
        {rows.length === 0 ? (
          <p className="text-sm text-os-subtle">No hay revisiones abiertas en las fichas de sujetos.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] border-collapse text-sm">
              <thead>
                <tr className="text-left text-xs text-os-subtle">
                  <th scope="col" className="px-3 py-2 font-semibold">Sujeto</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Estudio</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Espera</th>
                  <th scope="col" className="px-3 py-2 font-semibold"><span className="sr-only">Acción</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.subjectId} className="border-t border-alphi-border">
                    <td className="px-3 py-3 font-semibold text-os-ink">{row.subjectCode}</td>
                    <td className="px-3 py-3 text-os-ink">{row.studyLabel}</td>
                    <td className="px-3 py-3 text-os-subtle">{sinceLabel(row.since, now)}</td>
                    <td className="px-3 py-3 text-right">
                      <Link
                        href={`/studies/${row.studyId}/subjects/${row.subjectId}`}
                        className="inline-flex min-h-11 items-center rounded-lg border-[1.5px] border-os-accent px-4 text-sm font-semibold text-os-accentdim hover:bg-os-tint focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-os-accent"
                      >
                        Revisar
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}
