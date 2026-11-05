'use client'

import { demoStudy } from '../../lib/cabina/demo-data'
import { buildSheet } from '../../lib/cabina/filter'
import { addDays, weekAgenda, type VisitStatus } from '../../lib/cabina/schedule'
import { closingWindows, prepForDay, visitsOnDay } from '../../lib/cabina/week'

const focusRing = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0F5E73]'
const dateFormat = new Intl.DateTimeFormat('es-AR', { weekday: 'short', day: 'numeric', month: 'short' })

const STATUS_CLASS: Record<VisitStatus, string> = {
  verde: 'bg-[#DDF0E6] text-[#0E4D33]',
  ambar: 'bg-[#FFF1D6] text-[#6B4200]',
  rojo: 'bg-[#FBE3E7] text-[#8C1D3A]',
  sin_fecha: 'bg-[#EDF0F3] text-[#33424F]',
}

const STATUS_LABEL: Record<VisitStatus, string> = {
  verde: 'En ventana',
  ambar: 'Por cerrar',
  rojo: 'Cerrada',
  sin_fecha: 'Sin fecha',
}

export function SemanaView({ today }: { today: Date | null }) {
  if (!today) return <p className="text-sm text-alphi-muted">Las fechas se calculan en este navegador con el día de hoy.</p>
  const days = weekAgenda(demoStudy.patients, demoStudy.visits, today)
  const next = nextSiteDay(today)
  const upcoming = visitsOnDay(demoStudy.patients, demoStudy.visits, today, next.date)
  const prep = prepForDay(upcoming, demoStudy.patients, demoStudy.visits, demoStudy.procedures)
  const closing = closingWindows(demoStudy.patients, demoStudy.visits, today)

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold">
          {next.label}: {upcoming.length} {upcoming.length === 1 ? 'visita' : 'visitas'}
        </h2>
        <button type="button" className={`inline-flex min-h-11 items-center rounded-lg bg-[#0F5E73] px-4 text-sm font-semibold text-white ${focusRing}`} onClick={() => window.print()}>
          Imprimir hojas de {next.label === 'Mañana' ? 'mañana' : 'el lunes'}
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-5">
        {days.map((day) => (
          <section key={day.label} className="rounded-2xl border border-alphi-border bg-white p-3 shadow-alphi-card" aria-label={day.label}>
            <h3 className="text-sm font-semibold">{day.label}</h3>
            <ul className="mt-2 flex flex-col gap-2">
              {day.items.length === 0 ? <li className="text-xs text-alphi-muted">Sin visitas</li> : null}
              {day.items.map((item) => {
                const visit = demoStudy.visits.find((entry) => entry.key === item.visitKey)
                return (
                  <li key={`${item.patientCode}-${item.visitKey}`} className="rounded-xl border border-alphi-border p-2 text-sm">
                    <p className="font-semibold">{item.patientCode}</p>
                    <p>{visit ? `${visit.printedId} · ${visit.label}` : item.visitKey}</p>
                    <p className={`mt-1 inline-flex min-h-11 items-center rounded-full px-2 text-xs font-semibold ${STATUS_CLASS[item.status]}`}>{STATUS_LABEL[item.status]}</p>
                  </li>
                )
              })}
            </ul>
          </section>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-2xl border border-alphi-border bg-white p-5 shadow-alphi-card" aria-labelledby="semana-prep">
          <h2 id="semana-prep" className="text-base font-semibold">
            Qué preparar esta tarde
          </h2>
          {prep.length === 0 ? <p className="mt-2 text-sm text-alphi-muted">No hay preparación pendiente para {next.label.toLowerCase()}.</p> : null}
          <ul className="mt-2 list-disc pl-5 text-sm">
            {prep.map((label) => (
              <li key={label}>{label}</li>
            ))}
          </ul>
        </section>
        <section className="rounded-2xl border border-alphi-border bg-white p-5 shadow-alphi-card" aria-labelledby="semana-cierres">
          <h2 id="semana-cierres" className="text-base font-semibold">
            Ventanas que se cierran
          </h2>
          {closing.length === 0 ? <p className="mt-2 text-sm text-alphi-muted">Ninguna ventana cierra en los próximos siete días.</p> : null}
          <ul className="mt-3 flex flex-col gap-3">
            {closing.map((item) => (
              <li key={`${item.patientCode}-${item.visitKey}`}>
                <div className="mb-1 flex items-center justify-between gap-2 text-sm">
                  <span>
                    {item.patientCode} · {item.visitKey} {item.visitLabel}
                  </span>
                  <span className="font-semibold">{item.daysUntilClose === 0 ? 'cierra hoy' : `cierra en ${item.daysUntilClose} días`}</span>
                </div>
                <div className="h-3 rounded-full bg-[#EDF0F3]" aria-hidden="true">
                  <div
                    className={`h-3 rounded-full ${item.daysUntilClose <= 3 ? 'bg-[#B7791F]' : 'bg-[#0F5E73]'}`}
                    style={{ width: `${Math.max(8, (item.daysUntilClose / 7) * 100)}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        </section>
      </div>
      <p className="text-sm text-alphi-muted">Las fechas salen de la visita 2 real de cada paciente ficticio, contada desde hoy. Datos ficticios. Verificar siempre con el protocolo original.</p>
    </div>
  )
}

export function PrintSheets({ today }: { today: Date | null }) {
  if (!today) return null
  const next = nextSiteDay(today)
  const upcoming = visitsOnDay(demoStudy.patients, demoStudy.visits, today, next.date)
  const sheets = upcoming.length > 0 ? upcoming : [null]
  return (
    <div className="cabina-print" aria-hidden="true">
      {sheets.map((item, index) => {
        if (!item) {
          return (
            <article key="vacio" className="cabina-sheet">
              <h1>FIC-002 · {next.label}</h1>
              <p>No hay visitas con fecha objetivo.</p>
              <p>Datos ficticios. Verificar siempre con el protocolo original.</p>
            </article>
          )
        }
        const patient = demoStudy.patients.find((entry) => entry.code === item.patientCode)
        const visit = demoStudy.visits.find((entry) => entry.key === item.visitKey)
        const steps = patient && visit ? buildSheet(visit, demoStudy.procedures, demoStudy.cells, { ...patient.conditions, arm: patient.arm }).shown.filter((row) => row.procedure.section === 'day') : []
        return (
          <article key={`${item.patientCode}-${item.visitKey}-${index}`} className="cabina-sheet">
            <p>Estudio de demostración FIC-002 · Fase 3</p>
            <h1>
              Paciente {item.patientCode} · {visit ? `${visit.printedId} ${visit.label}` : item.visitKey}
            </h1>
            <p>
              {next.label}: {dateFormat.format(next.date)}. Estado: {STATUS_LABEL[item.status]}.
            </p>
            <ol>
              {steps.map((step) => (
                <li key={step.procedure.key}>
                  {step.procedure.label}. {step.procedure.detail}
                  {step.cell ? ` (p. ${step.cell.page})` : ''}
                </li>
              ))}
            </ol>
            <p>Datos ficticios. Verificar siempre con el protocolo original.</p>
          </article>
        )
      })}
    </div>
  )
}

function nextSiteDay(today: Date): { date: Date; label: string } {
  const tomorrow = addDays(today, 1)
  if (tomorrow.getDay() === 6) return { date: addDays(tomorrow, 2), label: 'El lunes' }
  if (tomorrow.getDay() === 0) return { date: addDays(tomorrow, 1), label: 'El lunes' }
  return { date: tomorrow, label: 'Mañana' }
}
