import { notFound } from 'next/navigation'
import { AgendaBoard } from '../../../components/agenda/agenda-board'
import { EmptyState, LoadError, PageHeader } from '../../../components/os/ui'
import { listAgenda } from '../../../lib/agenda/agenda-service'
import { dayKeyInZone, dayRange, isDayKey, weekOf } from '../../../lib/agenda/agenda-time'
import { loadOrgTimeZone } from '../../../lib/os/org-settings'
import { countByDay, toAgendaCard, type AgendaCard } from '../../../lib/agenda/agenda-view'
import { isOsEnabled } from '../../../lib/flags'
import { getOsContext } from '../../../lib/os/context'
import { listActiveStudies } from '../../../lib/os/inicio-data'

export const dynamic = 'force-dynamic'

/** Agenda del sitio: turnos de la semana, día por día, en la hora del sitio. */
export default async function AgendaPage({ searchParams }: { searchParams?: Promise<{ dia?: string }> }) {
  if (!isOsEnabled()) notFound()
  const ctx = await getOsContext()
  const header = <PageHeader title="Agenda" subtitle="Los turnos del sitio, día por día." />
  if (!ctx) {
    return (
      <div className="mx-auto flex max-w-5xl flex-col gap-5">
        {header}
        <EmptyState title="Elegí una organización" detail="Para ver la agenda necesitás tener una organización activa." />
      </div>
    )
  }

  const timeZone = await loadOrgTimeZone(ctx.orgId)
  const today = dayKeyInZone(new Date(), timeZone)
  const requested = (searchParams ? await searchParams : undefined)?.dia
  const day = typeof requested === 'string' && isDayKey(requested) ? requested : today
  const week = weekOf(day)

  let cards: AgendaCard[]
  let studies: Array<{ id: string; label: string }>
  try {
    const [entries, active] = await Promise.all([
      listAgenda({ orgId: ctx.orgId, scope: ctx.studyScope, from: dayRange(week[0]!, timeZone).start, to: dayRange(week[6]!, timeZone).end, includeSubjects: ctx.canSeeSubjects }),
      ctx.canSeeSubjects ? listActiveStudies(ctx.orgId, ctx.studyScope) : Promise.resolve([]),
    ])
    cards = entries.map((entry) => toAgendaCard(entry, timeZone))
    studies = active.map((study) => ({ id: study.id, label: study.label }))
  } catch {
    console.error('[os/agenda] load failed')
    return (
      <div className="mx-auto flex max-w-5xl flex-col gap-5">
        {header}
        <LoadError what="la agenda" />
      </div>
    )
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5">
      {header}
      <AgendaBoard day={day} today={today} week={week} counts={countByDay(cards)} cards={cards.filter((card) => card.day === day)} studies={studies} canEdit={ctx.canSeeSubjects} />
      <p className="text-sm text-os-subtle">
        Los turnos se cargan a mano. El cálculo automático desde la fecha ancla del sujeto y las ventanas del protocolo llega con la Cabina de visita.
      </p>
    </div>
  )
}
