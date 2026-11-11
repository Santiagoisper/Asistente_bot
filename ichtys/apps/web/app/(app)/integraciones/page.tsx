import { notFound } from 'next/navigation'
import { OS_MODULES } from '@ichtys/integrations'
import { ButtonLink, Card, EmptyState, PageHeader, Pill } from '../../../components/os/ui'
import { isOsEnabled } from '../../../lib/flags'
import { getOsContext } from '../../../lib/os/context'
import { MODULE_ROUTES, MODULE_TITLES, statusCopy } from '../../../lib/os/module-status'
import { loadModuleSummary } from '../../../lib/os/summaries'

export const dynamic = 'force-dynamic'

const timeFormat = new Intl.DateTimeFormat('es-AR', {
  timeZone: 'America/Argentina/Buenos_Aires',
  dateStyle: 'short',
  timeStyle: 'medium',
})

export default async function IntegracionesPage() {
  if (!isOsEnabled()) notFound()
  const ctx = await getOsContext()
  const header = (
    <PageHeader
      title="Integraciones"
      subtitle="Estado del enlace entre el OS y cada sistema. El OS solo lee; no escribe en ninguno."
      action={<ButtonLink href="/integraciones">Volver a comprobar</ButtonLink>}
    />
  )

  if (!ctx?.canAdministerOrg) {
    return (
      <div className="mx-auto flex max-w-5xl flex-col gap-5">
        {header}
        <EmptyState title="Solo para administradores" detail="El estado de las integraciones lo ve quien administra la organización." />
      </div>
    )
  }

  const results = await Promise.all(OS_MODULES.map((module) => loadModuleSummary(module, ctx.userId, ctx.orgId)))

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5">
      {header}
      <Card labelledBy="integraciones-estado" title="Sistemas enlazados">
        <ul className="divide-y divide-alphi-border">
          {results.map((result) => {
            const copy = statusCopy(result.status)
            return (
              <li key={result.module} className="flex flex-wrap items-center justify-between gap-3 py-4">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-os-ink">{MODULE_TITLES[result.module]}</p>
                  <p className="text-sm text-os-subtle">{copy.hint}</p>
                  <p className="mt-1 text-xs text-os-subtle">
                    {result.status === 'not_configured'
                      ? 'Esta organización no tiene este módulo conectado.'
                      : `Última comprobación: ${timeFormat.format(new Date(result.fetchedAt))}`}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <Pill tone={copy.tone}>{copy.label}</Pill>
                  <ButtonLink href={MODULE_ROUTES[result.module]}>Ver módulo</ButtonLink>
                </div>
              </li>
            )
          })}
        </ul>
      </Card>
      <p className="text-sm text-os-subtle">
        Cada sistema se enlaza con su URL y la clave pública del OS. El detalle del contrato está en{' '}
        <code className="rounded bg-white px-1.5 py-0.5 text-xs">packages/integrations/README.md</code>.
      </p>
    </div>
  )
}
