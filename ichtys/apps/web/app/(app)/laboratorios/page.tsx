import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Card, EmptyState, LoadError, PageHeader, Pill } from '../../../components/os/ui'
import { isOsEnabled } from '../../../lib/flags'
import { getOsContext } from '../../../lib/os/context'
import { sinceLabel } from '../../../lib/os/greeting'
import { listPendingLabReviews, type PendingLabReviewRow } from '../../../lib/os/inicio-data'

export const dynamic = 'force-dynamic'

const MAX_ROWS = 200

export default async function LaboratoriosPage() {
  if (!isOsEnabled()) notFound()
  const ctx = await getOsContext()
  const header = (
    <PageHeader
      title="Laboratorios"
      subtitle="Resultados que esperan que una persona los confirme mirando el estudio original."
      action={<Pill tone="soon">Carga por PDF o foto: próximamente</Pill>}
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
  try {
    rows = await listPendingLabReviews(ctx.orgId, MAX_ROWS)
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
        labelledBy="labs-pendientes"
        title="Pendientes de confirmar"
        subtitle={rows.length === 0 ? undefined : `${rows.length} ${rows.length === 1 ? 'sujeto' : 'sujetos'} con revisión abierta. No se muestran valores en esta lista.`}
      >
        {rows.length === 0 ? (
          <EmptyState title="Nada por revisar" detail="No hay resultados de laboratorio esperando confirmación." />
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
