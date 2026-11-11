import { notFound } from 'next/navigation'
import type { OsModule } from '@ichtys/integrations'
import { isOsEnabled } from '../../lib/flags'
import { getOsContext } from '../../lib/os/context'
import { formatCounter, MODULE_TITLES, statusCopy } from '../../lib/os/module-status'
import { loadModuleSummary } from '../../lib/os/summaries'
import { OpenSystemLink } from './module-card'
import { Card, EmptyState, PageHeader, Pill } from './ui'

const MODULE_ABOUT: Record<OsModule, { subtitle: string; whenConnected: string }> = {
  queries: {
    subtitle: 'Consultas de datos del patrocinador: abiertas, vencidas y por responsable.',
    whenConnected:
      'Cuando el sistema de queries esté enlazado vas a ver acá las consultas abiertas y vencidas, con acceso directo a cada caso.',
  },
  viaticos: {
    subtitle: 'Gastos de pacientes: solicitudes, rendiciones y montos del mes en USD.',
    whenConnected:
      'Cuando el sistema de viáticos esté enlazado vas a ver acá las solicitudes pendientes, las rendiciones en curso y el gasto del mes en dólares.',
  },
  operacion: {
    subtitle: 'Recorrido de los pacientes por las estaciones del centro y cumplimiento de visitas.',
    whenConnected:
      'Cuando el sistema de operación esté enlazado vas a ver acá el flujo del sitio: esperas por estación, desvíos abiertos y cumplimiento.',
  },
}

const SEVERITY_LABEL = { high: 'Alta', medium: 'Media', low: 'Baja' } as const
const SEVERITY_TONE = { high: 'error', medium: 'warn', low: 'idle' } as const

/** Página de un módulo satélite (Queries, Viáticos, Operación). */
export async function SatelliteModulePage({ module }: { module: OsModule }) {
  if (!isOsEnabled()) notFound()
  const ctx = await getOsContext()
  const about = MODULE_ABOUT[module]
  const title = MODULE_TITLES[module]

  if (!ctx) {
    return (
      <div className="mx-auto flex max-w-5xl flex-col gap-5">
        <PageHeader title={title} subtitle={about.subtitle} />
        <EmptyState title="Elegí una organización" detail="Para ver este módulo necesitás tener una organización activa." />
      </div>
    )
  }

  const result = await loadModuleSummary(module, ctx.userId, ctx.orgId)
  const copy = statusCopy(result.status)
  const summary = result.summary

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5">
      <PageHeader
        title={title}
        subtitle={about.subtitle}
        action={summary ? <OpenSystemLink href={summary.openHref} /> : undefined}
      />

      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-alphi-border bg-white px-5 py-4">
        <Pill tone={copy.tone}>{copy.label}</Pill>
        <p className="text-sm text-os-subtle">{result.status === 'not_configured' ? about.whenConnected : copy.hint}</p>
      </div>

      {summary ? (
        <>
          <Card labelledBy={`${module}-indicadores`} title="Indicadores">
            {summary.counters.length === 0 ? (
              <p className="text-sm text-os-subtle">El sistema no informó indicadores.</p>
            ) : (
              <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {summary.counters.map((counter) => (
                  <div key={counter.key} className="rounded-xl bg-os-ground px-4 py-3">
                    <dd className="text-2xl font-bold text-os-ink">{formatCounter(counter)}</dd>
                    <dt className="mt-1 text-sm text-os-subtle">{counter.label}</dt>
                  </div>
                ))}
              </dl>
            )}
          </Card>

          <Card labelledBy={`${module}-alertas`} title="Alertas">
            {summary.alerts.length === 0 ? (
              <p className="text-sm text-os-subtle">Nada pendiente en este sistema.</p>
            ) : (
              <ul className="divide-y divide-alphi-border">
                {summary.alerts.map((alert) => (
                  <li key={alert.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-os-ink">{alert.title}</p>
                      <p className="text-sm text-os-subtle">{alert.detail}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <Pill tone={SEVERITY_TONE[alert.severity]}>{SEVERITY_LABEL[alert.severity]}</Pill>
                      <a
                        href={alert.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex min-h-11 items-center text-sm font-semibold text-os-accentdim underline"
                      >
                        Abrir
                      </a>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      ) : null}
    </div>
  )
}

/** Página de un módulo que todavía no se construyó: dice qué va a hacer y cuándo llega. */
export function ComingSoonPage({
  title,
  subtitle,
  stage,
  points,
}: {
  title: string
  subtitle: string
  stage: string
  points: string[]
}) {
  if (!isOsEnabled()) notFound()
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5">
      <PageHeader title={title} subtitle={subtitle} action={<Pill tone="soon">Próximamente</Pill>} />
      <Card labelledBy="modulo-que-viene" title="Qué va a hacer este módulo" subtitle={stage}>
        <ul className="flex list-disc flex-col gap-2 pl-5 text-sm text-os-ink">
          {points.map((point) => (
            <li key={point}>{point}</li>
          ))}
        </ul>
      </Card>
    </div>
  )
}
