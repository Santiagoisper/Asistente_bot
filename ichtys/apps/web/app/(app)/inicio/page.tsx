import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Suspense, type ReactNode } from 'react'
import { BookOpen, CalendarDays, FlaskConical, MessageSquare, Mic } from 'lucide-react'
import { ModuleCard } from '../../../components/os/module-card'
import { ProtocolIntelligence } from '../../../components/os/protocol-intelligence'
import { ButtonLink, Card, EmptyState, LoadError, Pill, StatCard, cardClass } from '../../../components/os/ui'
import { KIND_LABELS, STATUS_LABELS } from '../../../lib/agenda/agenda-schema'
import { listAgendaDay } from '../../../lib/agenda/agenda-service'
import { dayKeyInZone, siteTimeZone } from '../../../lib/agenda/agenda-time'
import { daySummary, toAgendaCard } from '../../../lib/agenda/agenda-view'
import { isOsEnabled } from '../../../lib/flags'
import { getFirstName, getOsContext, type OsContext } from '../../../lib/os/context'
import { greetingFor, longDate, sinceLabel } from '../../../lib/os/greeting'
import {
  countActiveStudies,
  countPendingLabWork,
  labOutcomes30d,
  listPriorityItems,
  listStudiesWithReadyDocs,
} from '../../../lib/os/inicio-data'
import { formatCounter } from '../../../lib/os/module-status'
import { isExternalHref } from '../../../lib/os/priority'
import { loadModuleSummary } from '../../../lib/os/summaries'

export const dynamic = 'force-dynamic'

const PRIORITY_VISIBLE = 8
const number = new Intl.NumberFormat('es-AR')

function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={`animate-pulse rounded-2xl border border-alphi-border bg-white ${className ?? 'h-28'}`} />
}

/** Cada widget carga por separado: si uno falla, muestra su error y el resto sigue. */
async function guarded(what: string, render: () => Promise<ReactNode>): Promise<ReactNode> {
  try {
    return await render()
  } catch {
    console.error(`[os/inicio] widget failed: ${what}`)
    return (
      <div className={cardClass}>
        <LoadError what={what} />
      </div>
    )
  }
}

async function Greeting() {
  const now = new Date()
  const firstName = await getFirstName()
  return (
    <div className="rounded-2xl bg-os-tint px-6 py-5">
      <p className="text-sm font-medium capitalize text-os-accentdim">{longDate(now)}</p>
      <h1 className="mt-1 text-3xl font-bold text-os-ink">
        {greetingFor(now)}
        {firstName ? `, ${firstName}` : ''}
      </h1>
      <p className="mt-1 text-sm text-os-subtle">Este es el estado de las operaciones de investigación clínica de hoy.</p>
    </div>
  )
}

async function TodayTurnsStat({ ctx }: { ctx: OsContext }) {
  return guarded('los turnos de hoy', async () => {
    const timeZone = siteTimeZone()
    const live = (await listAgendaDay({ orgId: ctx.orgId, dayKey: dayKeyInZone(new Date(), timeZone), timeZone, includeSubjects: false })).filter((entry) => entry.status !== 'cancelled')
    const pending = live.filter((entry) => entry.status === 'scheduled').length
    return (
      <StatCard
        label="Turnos de hoy"
        value={number.format(live.length)}
        note={live.length === 0 ? 'sin turnos' : pending === 0 ? 'todos resueltos' : `${pending} ${pending === 1 ? 'pendiente' : 'pendientes'}`}
        icon={<CalendarDays aria-hidden="true" className="h-6 w-6" strokeWidth={1.75} />}
        href="/agenda"
      />
    )
  })
}

async function ActiveStudiesStat({ ctx }: { ctx: OsContext }) {
  return guarded('los protocolos activos', async () => {
    const total = await countActiveStudies(ctx.orgId)
    return (
      <StatCard
        label="Protocolos activos"
        value={number.format(total)}
        note={total === 1 ? 'estudio' : 'estudios'}
        icon={<BookOpen aria-hidden="true" className="h-6 w-6" strokeWidth={1.75} />}
        href="/studies"
      />
    )
  })
}

async function PendingLabsStat({ ctx }: { ctx: OsContext }) {
  return guarded('los laboratorios pendientes', async () => {
    const icon = <FlaskConical aria-hidden="true" className="h-6 w-6" strokeWidth={1.75} />
    if (!ctx.canSeeSubjects) {
      return <StatCard label="Labs pendientes" value={null} note="Tu rol no ve datos de sujetos" icon={icon} />
    }
    const total = await countPendingLabWork(ctx.orgId)
    return (
      <StatCard
        label="Labs pendientes"
        value={number.format(total)}
        note={total === 0 ? 'nada por revisar' : 'por confirmar'}
        icon={icon}
        href="/laboratorios"
      />
    )
  })
}

async function OpenQueriesStat({ ctx }: { ctx: OsContext }) {
  return guarded('las queries abiertas', async () => {
    const result = await loadModuleSummary('queries', ctx.userId, ctx.orgId)
    const counter = result.summary?.counters.find((entry) => entry.key === 'open_queries')
    return (
      <StatCard
        label="Queries abiertas"
        value={counter ? formatCounter(counter) : null}
        note={counter ? 'en el sistema de queries' : result.status === 'ok' ? 'sin dato' : 'Sin conectar'}
        icon={<MessageSquare aria-hidden="true" className="h-6 w-6" strokeWidth={1.75} />}
        href="/queries"
      />
    )
  })
}

/** Turnos de hoy en la hora del sitio. Los cancelados no se listan. */
async function TodayAgenda({ ctx }: { ctx: OsContext }) {
  return guarded('la jornada de hoy', async () => {
    const timeZone = siteTimeZone()
    const today = dayKeyInZone(new Date(), timeZone)
    const cards = (await listAgendaDay({ orgId: ctx.orgId, dayKey: today, timeZone, includeSubjects: ctx.canSeeSubjects }))
      .map((entry) => toAgendaCard(entry, timeZone))
      .filter((card) => card.status !== 'cancelled')
    if (cards.length === 0) {
      return <EmptyState title="No hay turnos para hoy" detail="Cuando agendes una visita para hoy, aparece acá con su hora, sujeto, estudio y estado." action={<ButtonLink href="/agenda" variant="solid">Agendar un turno</ButtonLink>} />
    }
    return (
      <>
        <p className="mb-2 text-sm text-os-subtle">{daySummary(cards)}</p>
        <ol className="flex flex-col">
          {cards.slice(0, 8).map((card) => (
            <li key={card.id}>
              <Link href="/agenda" className="flex min-h-11 items-center justify-between gap-3 rounded-xl px-3 py-2 hover:bg-os-ground focus-visible:outline focus-visible:outline-2 focus-visible:outline-os-accent">
                <span className="flex min-w-0 items-center gap-3">
                  <span className="w-12 shrink-0 text-sm font-bold tabular-nums text-os-ink">{card.time}</span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-os-ink">{card.title}</span>
                    <span className="block truncate text-sm text-os-subtle">{[card.subjectCode, card.studyLabel, KIND_LABELS[card.kind]].filter(Boolean).join(' · ')}</span>
                  </span>
                </span>
                <Pill tone={card.status === 'done' ? 'ok' : card.status === 'no_show' ? 'error' : 'info'}>{STATUS_LABELS[card.status]}</Pill>
              </Link>
            </li>
          ))}
        </ol>
        {cards.length > 8 ? <p className="mt-2 text-sm text-os-subtle">Y {cards.length - 8} más en la agenda.</p> : null}
      </>
    )
  })
}

async function PriorityList({ ctx }: { ctx: OsContext }) {
  return guarded('la atención prioritaria', async () => {
    const now = new Date()
    const satellites = await Promise.all(
      (['queries', 'viaticos', 'operacion'] as const).map(async (module) => ({
        module,
        alerts: (await loadModuleSummary(module, ctx.userId, ctx.orgId)).summary?.alerts ?? [],
      })),
    )
    const items = await listPriorityItems(ctx.orgId, { includeSubjects: ctx.canSeeSubjects, satellites })
    const visible = items.slice(0, PRIORITY_VISIBLE)
    const rest = items.slice(PRIORITY_VISIBLE)

    const row = (item: (typeof items)[number]) => {
      const body = (
        <>
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-os-ink">{item.title}</span>
            <span className="block truncate text-sm text-os-subtle">{item.detail}</span>
          </span>
          <span className="flex shrink-0 items-center gap-2">
            {item.since ? <span className="text-xs text-os-subtle">{sinceLabel(new Date(item.since), now)}</span> : null}
            <Pill tone={item.severity === 'high' ? 'error' : item.severity === 'medium' ? 'warn' : 'idle'}>
              {item.severity === 'high' ? 'Alta' : item.severity === 'medium' ? 'Media' : 'Baja'}
            </Pill>
          </span>
        </>
      )
      const className =
        'flex min-h-11 items-center justify-between gap-3 rounded-xl px-3 py-2 hover:bg-os-ground focus-visible:outline focus-visible:outline-2 focus-visible:outline-os-accent'
      return (
        <li key={item.id}>
          {isExternalHref(item.href) ? (
            <a href={item.href} target="_blank" rel="noopener noreferrer" className={className}>
              {body}
            </a>
          ) : (
            <Link href={item.href} className={className}>
              {body}
            </Link>
          )}
        </li>
      )
    }

    return (
      <Card labelledBy="atencion-prioritaria" title="Atención prioritaria" subtitle="Lo que hoy necesita que alguien actúe.">
        {items.length === 0 ? (
          <EmptyState title="Nada pendiente" detail="No hay laboratorios por confirmar, documentos con error ni specs sin aprobar." />
        ) : (
          <>
            <ul className="flex flex-col gap-1">{visible.map(row)}</ul>
            {rest.length > 0 ? (
              <details className="mt-2">
                <summary className="inline-flex min-h-11 cursor-pointer items-center px-3 text-sm font-semibold text-os-accentdim">
                  Ver todos ({items.length})
                </summary>
                <ul className="flex flex-col gap-1">{rest.map(row)}</ul>
              </details>
            ) : null}
          </>
        )}
      </Card>
    )
  })
}

async function ProtocolIntelligenceCard({ ctx }: { ctx: OsContext }) {
  return guarded('Protocol Intelligence', async () => {
    const studies = await listStudiesWithReadyDocs(ctx.orgId)
    return (
      <Card
        labelledBy="protocol-intelligence"
        title="Protocol Intelligence"
        subtitle="Preguntale al protocolo y recibí la respuesta con sus referencias."
        action={<ButtonLink href="/studies">Ver protocolos</ButtonLink>}
      >
        {studies.length === 0 ? (
          <EmptyState
            title="Todavía no hay protocolos listos"
            detail="Cargá el protocolo de un estudio y esperá a que termine de procesarse para poder consultarlo."
            action={<ButtonLink href="/studies" variant="solid">Ir a Protocolos</ButtonLink>}
          />
        ) : (
          <ProtocolIntelligence studies={studies} />
        )}
      </Card>
    )
  })
}

async function LabsCard({ ctx }: { ctx: OsContext }) {
  return guarded('el resumen de laboratorios', async () => {
    if (!ctx.canSeeSubjects) {
      return (
        <Card labelledBy="inicio-laboratorios" title="Laboratorios" subtitle="Revisión de resultados del sitio.">
          <p className="text-sm text-os-subtle">Tu rol no tiene acceso a datos de sujetos.</p>
        </Card>
      )
    }
    const [pending, outcomes] = await Promise.all([countPendingLabWork(ctx.orgId), labOutcomes30d(ctx.orgId, new Date())])
    const cells = [
      { value: pending, label: 'pendientes' },
      { value: outcomes.confirmed, label: 'confirmados (30 días)' },
      { value: outcomes.rejected, label: 'rechazados (30 días)' },
    ]
    return (
      <Card
        labelledBy="inicio-laboratorios"
        title="Laboratorios"
        subtitle="Revisión de resultados del sitio."
        action={<ButtonLink href="/laboratorios">Revisar labs</ButtonLink>}
      >
        <dl className="grid grid-cols-3 divide-x divide-alphi-border">
          {cells.map((cell) => (
            <div key={cell.label} className="px-3 first:pl-0">
              <dd className="text-2xl font-bold text-os-ink">{number.format(cell.value)}</dd>
              <dt className="mt-1 text-xs text-os-subtle">{cell.label}</dt>
            </div>
          ))}
        </dl>
      </Card>
    )
  })
}

async function SatelliteCard({
  ctx,
  module,
  id,
  title,
  subtitle,
}: {
  ctx: OsContext
  module: 'viaticos' | 'operacion'
  id: string
  title: string
  subtitle: string
}) {
  return guarded(title, async () => (
    <ModuleCard id={id} title={title} subtitle={subtitle} result={await loadModuleSummary(module, ctx.userId, ctx.orgId)} />
  ))
}

export default async function InicioPage() {
  if (!isOsEnabled()) notFound()
  const ctx = await getOsContext()

  if (!ctx) {
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-5">
        <Suspense fallback={<Skeleton className="h-32" />}>
          <Greeting />
        </Suspense>
        <EmptyState
          title="Elegí una organización para empezar"
          detail="El Inicio muestra los datos de la organización activa. Elegila desde el selector de arriba o creá tu primer estudio."
          action={<ButtonLink href="/studies" variant="solid">Ir a Protocolos</ButtonLink>}
        />
      </div>
    )
  }

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-5">
      <Suspense fallback={<Skeleton className="h-32" />}>
        <Greeting />
      </Suspense>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Suspense fallback={<Skeleton />}>
          <TodayTurnsStat ctx={ctx} />
        </Suspense>
        <Suspense fallback={<Skeleton />}>
          <PendingLabsStat ctx={ctx} />
        </Suspense>
        <Suspense fallback={<Skeleton />}>
          <OpenQueriesStat ctx={ctx} />
        </Suspense>
        <Suspense fallback={<Skeleton />}>
          <ActiveStudiesStat ctx={ctx} />
        </Suspense>
      </div>

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card
          labelledBy="jornada-de-hoy"
          title="Jornada de hoy"
          subtitle="Turnos programados en el sitio."
          action={<ButtonLink href="/agenda">Ver agenda</ButtonLink>}
        >
          <Suspense fallback={<Skeleton className="h-40" />}>
            <TodayAgenda ctx={ctx} />
          </Suspense>
        </Card>
        <Suspense fallback={<Skeleton className="h-64" />}>
          <PriorityList ctx={ctx} />
        </Suspense>
      </div>

      <div className="grid items-start gap-4 xl:grid-cols-2">
        <Suspense fallback={<Skeleton className="h-64" />}>
          <ProtocolIntelligenceCard ctx={ctx} />
        </Suspense>
        <Card
          labelledBy="consulta-asistida"
          title="Consulta asistida"
          subtitle="Escucha la consulta, la transcribe y propone un borrador de evolución."
          action={<Pill tone="soon">Próximamente</Pill>}
        >
          <div className="flex items-start gap-4 rounded-xl border border-dashed border-alphi-border bg-os-ground px-4 py-5">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-white text-os-accent">
              <Mic aria-hidden="true" className="h-6 w-6" strokeWidth={1.75} />
            </span>
            <p className="text-sm text-os-subtle">
              La grabación en vivo se va a probar primero con consultas simuladas. No se graba a ningún paciente hasta tener el
              consentimiento y el acuerdo de datos del proveedor de transcripción.
            </p>
          </div>
        </Card>
      </div>

      <div className="grid items-start gap-4 xl:grid-cols-3">
        <Suspense fallback={<Skeleton className="h-40" />}>
          <LabsCard ctx={ctx} />
        </Suspense>
        <Suspense fallback={<Skeleton className="h-40" />}>
          <SatelliteCard ctx={ctx} module="operacion" id="inicio-flujo" title="Flujo del site" subtitle="Estado operativo y cumplimiento." />
        </Suspense>
        <Suspense fallback={<Skeleton className="h-40" />}>
          <SatelliteCard ctx={ctx} module="viaticos" id="inicio-viaticos" title="Viáticos" subtitle="Solicitudes y rendiciones, en USD." />
        </Suspense>
      </div>
    </div>
  )
}
