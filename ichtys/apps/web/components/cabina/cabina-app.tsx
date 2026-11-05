'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { OrigenPanel } from './origen-panel'
import { PrintSheets, SemanaView } from './semana-view'
import { answerQuestion } from '../../lib/cabina/answers'
import { checklistKey, readChecklist, safeStorage, writeChecklist } from '../../lib/cabina/checklist'
import { demoStudy } from '../../lib/cabina/demo-data'
import { buildSheet, type SheetItem } from '../../lib/cabina/filter'
import { unresolvedKeys } from '../../lib/cabina/origen'
import { addDays, diffDays, parseISODate, planVisit, startOfDay, toISODate, type VisitPlan } from '../../lib/cabina/schedule'
import type { PatientConditions, PatientDef, SheetSection, VisitDef } from '../../lib/cabina/types'

const focusRing = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0F5E73]'
const fieldClass = `min-h-11 w-full rounded-lg border border-alphi-border bg-white px-3 text-base text-alphi-navy ${focusRing}`
const cardClass = 'rounded-2xl border border-alphi-border bg-white p-5 shadow-alphi-card'
const dateFormat = new Intl.DateTimeFormat('es-AR', { weekday: 'short', day: 'numeric', month: 'short' })

const STATUS_CLASS = {
  verde: 'bg-[#DDF0E6] text-[#0E4D33]',
  ambar: 'bg-[#FFF1D6] text-[#6B4200]',
  rojo: 'bg-[#FBE3E7] text-[#8C1D3A]',
  sin_fecha: 'bg-[#EDF0F3] text-[#33424F]',
} as const

const STATUS_LABEL = {
  verde: 'Dentro de la ventana',
  ambar: 'Ventana por abrir o por cerrar',
  rojo: 'Ventana cerrada',
  sin_fecha: 'Sin fecha en el protocolo',
} as const

type ConditionKey = keyof PatientConditions

const TOGGLES: Array<{ key: ConditionKey; label: string }> = [
  { key: 'dt2', label: 'DT2' },
  { key: 'erc', label: 'ERC' },
  { key: 'ic', label: 'IC' },
  { key: 'wocbp', label: 'Mujer en edad fértil' },
]

export function CabinaApp() {
  const [patientId, setPatientId] = useState(demoStudy.patients[0]?.id ?? '')
  const [visitKey, setVisitKey] = useState('V11')
  const [arm, setArm] = useState<'A' | 'B'>(demoStudy.patients[0]?.arm ?? 'B')
  const [conditions, setConditions] = useState<PatientConditions>(
    demoStudy.patients[0]?.conditions ?? { dt2: false, erc: false, ic: false, wocbp: false },
  )
  const [today, setToday] = useState<Date | null>(null)
  const [anchorIso, setAnchorIso] = useState<string | null>(null)
  const [showHidden, setShowHidden] = useState(false)
  const [consultKey, setConsultKey] = useState<string | null>(null)
  const [manualLoaded, setManualLoaded] = useState<Record<string, boolean>>({})
  const [checked, setChecked] = useState<string[]>([])
  const [reviewed, setReviewed] = useState<string[]>([])
  const [doubted, setDoubted] = useState<string[]>([])
  const [quoteEdits, setQuoteEdits] = useState<Record<string, string>>({})
  const [panelKey, setPanelKey] = useState<string | null>(null)
  const [approved, setApproved] = useState(false)
  const [view, setView] = useState<'cabina' | 'semana'>('cabina')
  const [mobileTab, setMobileTab] = useState<'antes' | 'dia' | 'alertas'>('dia')
  const [question, setQuestion] = useState('')
  const [reply, setReply] = useState<{ text: string; page: number | null } | null>(null)
  const [moreOpen, setMoreOpen] = useState(false)
  const askRef = useRef<HTMLInputElement>(null)
  const desktopPanel = useDesktopPanel()

  useEffect(() => {
    const now = startOfDay(new Date())
    const next = demoStudy.patients.find((item) => item.id === patientId) ?? demoStudy.patients[0]
    if (!next) return
    setToday(now)
    setArm(next.arm)
    setConditions({ ...next.conditions })
    setAnchorIso(toISODate(addDays(now, next.anchorOffsetDays)))
    setShowHidden(false)
    setConsultKey(null)
    setManualLoaded({})
    setReviewed([])
    setDoubted([])
    setPanelKey(null)
    setApproved(false)
  }, [patientId])

  useEffect(() => {
    setChecked(readChecklist(safeStorage(), checklistKey(patientId, visitKey)))
  }, [patientId, visitKey])

  const patient = demoStudy.patients.find((item) => item.id === patientId) ?? demoStudy.patients[0]
  const visit = demoStudy.visits.find((item) => item.key === visitKey) ?? demoStudy.visits[0]
  if (!patient || !visit) return null

  const sheet = buildSheet(visit, demoStudy.procedures, demoStudy.cells, { ...conditions, arm })
  const anchor = anchorIso ? parseISODate(anchorIso) : null
  const plan = anchor && today ? planVisit(visit, anchor, today) : null
  const before = itemsOf(sheet.shown, 'before')
  const day = itemsOf(sheet.shown, 'day')
  const alerts = [...itemsOf(sheet.shown, 'block'), ...itemsOf(sheet.shown, 'undefined'), ...itemsOf(sheet.shown, 'sponsor')]
  const labs = itemsOf(sheet.shown, 'lab')
  const meds = itemsOf(sheet.shown, 'med')
  const blocks = itemsOf(sheet.shown, 'block').length
  const undefinedCount = itemsOf(sheet.shown, 'undefined').length
  const sponsorCount = itemsOf(sheet.shown, 'sponsor').length
  const tables = [...new Set(demoStudy.visits.map((item) => item.tableKey))]
  const doubts = unresolvedKeys(
    sheet.shown.map((item) => ({ procedureKey: item.procedure.key, certainty: item.cell?.certainty ?? null })),
    new Set(reviewed),
    new Set(doubted),
  )
  const blocked = doubts.length > 0
  const panelItem = sheet.shown.find((item) => item.procedure.key === panelKey) ?? null

  function toggleCheck(procedureKey: string, on: boolean) {
    const next = on ? Array.from(new Set([...checked, procedureKey])) : checked.filter((item) => item !== procedureKey)
    setChecked(next)
    writeChecklist(safeStorage(), checklistKey(patientId, visitKey), next)
  }

  function markDoubt(procedureKey: string) {
    setDoubted((current) => (current.includes(procedureKey) ? current : [...current, procedureKey]))
    setReviewed((current) => current.filter((item) => item !== procedureKey))
    setApproved(false)
  }

  function chip(item: SheetItem) {
    return <PageChip item={item} marked={doubts.includes(item.procedure.key)} onOpen={setPanelKey} />
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 pb-40 text-alphi-navy lg:pb-0">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm text-alphi-muted">
            {demoStudy.title} {demoStudy.code} · {demoStudy.phase}
            <span className="text-alphi-navy"> · Paciente {patient.code}</span>
            <span className="text-alphi-navy"> · Visita {visit.printedId}</span>
          </p>
          <h1 className="mt-1 text-2xl font-semibold">{view === 'cabina' ? 'Cabina de visita' : 'Semana del sitio'}</h1>
          <div className="mt-3 flex gap-2">
            <button type="button" className={viewButton(view === 'cabina')} aria-pressed={view === 'cabina'} onClick={() => setView('cabina')}>
              Cabina
            </button>
            <button type="button" className={viewButton(view === 'semana')} aria-pressed={view === 'semana'} onClick={() => setView('semana')}>
              Semana
            </button>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex min-h-11 items-center rounded-full bg-[#DDF0E6] px-4 text-sm font-semibold text-[#0E4D33]">
            Protocolo ficticio
          </span>
          {view === 'cabina' ? (
          <button
            type="button"
            className={`inline-flex min-h-11 items-center rounded-lg bg-[#0F5E73] px-4 text-sm font-semibold text-white disabled:opacity-50 ${focusRing}`}
            disabled={blocked}
            aria-describedby={blocked ? 'cabina-bloqueo-aprobacion' : undefined}
            onClick={() => setApproved(true)}
          >
            {approved ? 'Aprobada' : 'Aprobar'}
          </button>
          ) : null}
          <button
            type="button"
            className={`inline-flex min-h-11 items-center rounded-lg border-[1.5px] border-[#0F5E73] px-4 text-sm font-semibold text-[#0A4455] disabled:opacity-50 ${focusRing}`}
            disabled={view === 'cabina' && blocked}
            aria-describedby={view === 'cabina' && blocked ? 'cabina-bloqueo-aprobacion' : undefined}
            onClick={() => window.print()}
          >
            Imprimir
          </button>
          {view === 'cabina' && blocked ? (
            <button type="button" className={`inline-flex min-h-11 items-center rounded-lg bg-[#FFF1D6] px-4 text-sm font-semibold text-[#6B4200] ${focusRing}`} onClick={() => setReviewed((current) => Array.from(new Set([...current, ...doubts])))}>
              Revisar
            </button>
          ) : null}
        </div>
      </div>
      {view === 'cabina' && blocked ? (
        <p id="cabina-bloqueo-aprobacion" className="text-sm text-[#6B4200]" role="status">
          Hay {doubts.length === 1 ? 'una casilla con duda' : `${doubts.length} casillas con duda`}. Hay que revisarlas antes de aprobar o imprimir.
        </p>
      ) : null}

      {view === 'semana' ? <SemanaView today={today} /> : null}
      {view === 'cabina' ? (
      <>
      <section className={`${cardClass} grid gap-6 lg:grid-cols-[1.1fr_1.6fr_1fr] lg:items-center`} aria-label="Visita y ventana">
        <div className="flex flex-col gap-3">
          <label className="block text-sm font-semibold" htmlFor="demo-visit">
            Visita
          </label>
          <select
            id="demo-visit"
            className={fieldClass}
            value={visit.key}
            onChange={(event) => {
              setVisitKey(event.target.value)
              setConsultKey(null)
              setManualLoaded({})
              setReviewed([])
              setDoubted([])
              setPanelKey(null)
              setApproved(false)
            }}
          >
            {tables.map((tableKey) => {
              const group = demoStudy.visits.filter((item) => item.tableKey === tableKey)
              return (
                <optgroup key={tableKey} label={group[0]?.tableTitle ?? tableKey}>
                  {group.map((item) => (
                    <option key={item.key} value={item.key}>
                      {item.printedId} · {item.label}
                    </option>
                  ))}
                </optgroup>
              )
            })}
          </select>
          <label className="block text-sm font-semibold" htmlFor="demo-patient">
            Paciente ficticio
          </label>
          <select id="demo-patient" className={fieldClass} value={patient.id} onChange={(event) => setPatientId(event.target.value)}>
            {demoStudy.patients.map((item) => (
              <option key={item.id} value={item.id}>
                {patientOption(item)}
              </option>
            ))}
          </select>
          <div className="flex flex-wrap gap-2">
            <VisitFlag on={visit.annual} label="Anual" />
            <VisitFlag on={visit.attributes.fasting === true} label="Ayuno ≥ 8 h" tone="amber" />
            <VisitFlag on={visit.attributes.onSite === true} label="Presencial" tone="grey" />
          </div>
          <p className="text-sm text-alphi-muted">
            <span className="font-semibold text-alphi-navy">{visit.printedId}</span> {visit.label}
            {visit.timing.kind === 'recurrent' ? ' · se repite' : ''}
            {visit.timing.kind === 'event' ? ' · por evento' : ''}
          </p>
        </div>

        <div>
          {plan && today && anchor ? (
            <WindowCard plan={plan} visit={visit} today={today} anchor={anchor} anchorIso={anchorIso ?? ''} onAnchor={setAnchorIso} />
          ) : (
            <p className="text-sm text-alphi-muted">Las fechas se calculan en este navegador con el día de hoy.</p>
          )}
        </div>

        <div className="flex flex-col gap-2">
          {blocks > 0 ? <CountChip tone="red" label={countLabel(blocks, 'bloqueo abierto', 'bloqueos abiertos')} /> : null}
          {undefinedCount > 0 ? <CountChip tone="amber" label={countLabel(undefinedCount, 'dato no definido', 'datos no definidos')} /> : null}
          {sponsorCount > 0 ? <CountChip tone="violet" label={countLabel(sponsorCount, 'duda para el patrocinador', 'dudas para el patrocinador')} /> : null}
        </div>
      </section>

      <section className="flex flex-wrap items-center gap-2 rounded-2xl border border-alphi-border bg-white px-4 py-3 shadow-alphi-card" aria-label="Condiciones del paciente">
        <span className="mr-1 text-sm font-semibold">Hoja armada para este paciente:</span>
        <button type="button" className={chipButton(arm === 'A')} aria-pressed={arm === 'A'} onClick={() => setArm('A')}>
          Rama A
        </button>
        <button type="button" className={chipButton(arm === 'B')} aria-pressed={arm === 'B'} onClick={() => setArm('B')}>
          Rama B
        </button>
        {TOGGLES.map((toggle) => {
          const on = conditions[toggle.key]
          return (
            <button key={toggle.key} type="button" className={chipButton(on)} aria-pressed={on} onClick={() => setConditions((current) => ({ ...current, [toggle.key]: !current[toggle.key] }))}>
              <span className={on ? '' : 'line-through'}>
                {toggle.label} · {on ? 'sí' : 'no'}
              </span>
            </button>
          )
        })}
        <div className="ml-auto text-sm text-alphi-muted" aria-live="polite">
          {sheet.hidden.length === 0
            ? 'No se ocultó ningún procedimiento.'
            : `Se ocultaron ${sheet.hidden.length} procedimientos que no le corresponden.`}{' '}
          <button
            type="button"
            className={`inline-flex min-h-11 items-center font-semibold text-[#0F5E73] underline ${focusRing}`}
            aria-expanded={showHidden}
            onClick={() => setShowHidden((open) => !open)}
          >
            ver cuáles
          </button>
        </div>
        {showHidden ? (
          <ul className="mt-1 w-full list-disc pl-5 text-sm">
            {sheet.hidden.map((item) => (
              <li key={item.procedure.key}>
                {item.procedure.label}
                {item.procedure.conditions.length > 0 ? ` · ${item.procedure.conditions.map((condition) => condition.expr).join(', ')}` : ''}
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <div className="flex gap-2 lg:hidden" role="tablist" aria-label="Partes de la visita">
        {([['antes', 'Antes'], ['dia', 'El día'], ['alertas', 'Alertas']] as const).map(([key, label]) => (
          <button key={key} type="button" role="tab" aria-selected={mobileTab === key} className={viewButton(mobileTab === key)} onClick={() => setMobileTab(key)}>
            {label}
          </button>
        ))}
      </div>
      <div className="grid items-start gap-4 lg:grid-cols-[1fr_1.25fr_1fr]">
        <section className={`${cardClass} ${phonePanel(mobileTab === 'antes')}`} aria-labelledby="cabina-antes">
          <h2 id="cabina-antes" className="mb-2 text-base font-semibold">
            Antes de la visita
          </h2>
          <ul>
            {before.map((item) => (
              <li key={item.procedure.key} className="flex gap-3 border-t border-alphi-border py-3 text-sm first:border-t-0">
                <span className="inline-flex h-7 shrink-0 items-center rounded-full bg-[#EDF0F3] px-2 text-xs font-semibold text-[#33424F]">
                  {item.procedure.whenLabel}
                </span>
                <span>
                  {item.procedure.detail} <ConditionTags item={item} /> {chip(item)}
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section className={`${cardClass} ${phonePanel(mobileTab === 'dia')}`} aria-labelledby="cabina-dia">
          <h2 id="cabina-dia" className="mb-2 text-base font-semibold">
            El día, en orden
          </h2>
          <ol aria-label="Checklist del día">
            {day.map((item) => (
              <li key={item.procedure.key} className={`flex gap-3 border-t border-alphi-border py-3 text-sm first:border-t-0 ${doubts.includes(item.procedure.key) ? 'rounded-lg border border-dashed border-[#B7791F] px-2' : ''}`}>
                <label className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center" onClick={(event) => event.stopPropagation()}>
                  <input
                    type="checkbox"
                    className={`h-11 w-11 accent-[#0F5E73] ${focusRing}`}
                    checked={checked.includes(item.procedure.key)}
                    aria-label={`Hecho: ${item.procedure.label}`}
                    onClick={(event) => event.stopPropagation()}
                    onChange={(event) => toggleCheck(item.procedure.key, event.target.checked)}
                  />
                </label>
                <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#0F5E73] text-xs font-semibold text-white">
                  {item.procedure.order < 20 ? item.procedure.order : '·'}
                </span>
                <span>
                  <span className="font-semibold">{item.procedure.label}</span>: {item.procedure.detail} <ConditionTags item={item} /> {chip(item)}
                  {item.cell ? (
                    <button
                      type="button"
                      className={`ml-1 inline-flex min-h-11 items-center rounded-md px-2 text-sm font-semibold text-[#0F5E73] ${focusRing}`}
                      onClick={(event) => {
                        event.stopPropagation()
                        setPanelKey(item.procedure.key)
                      }}
                    >
                      Ver cita
                    </button>
                  ) : null}
                </span>
              </li>
            ))}
          </ol>
          <p className="mt-2 text-xs text-alphi-muted">El protocolo fija el orden de los pasos 2 a 5. Los demás pasos no tienen un orden fijado.</p>
        </section>

        <div className={`flex flex-col gap-3 ${phonePanel(mobileTab === 'alertas')}`}>
          {alerts.map((item) => (
            <AlertCard
              key={item.procedure.key}
              item={item}
              consultOpen={consultKey === item.procedure.key}
              manualLoaded={manualLoaded[item.procedure.key] === true}
              marked={doubts.includes(item.procedure.key)}
              onOpen={setPanelKey}
              onConsult={() => setConsultKey((current) => (current === item.procedure.key ? null : item.procedure.key))}
              onManual={() => setManualLoaded((current) => ({ ...current, [item.procedure.key]: true }))}
            />
          ))}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <section className={cardClass} aria-labelledby="cabina-lab">
          <h2 id="cabina-lab" className="mb-3 text-base font-semibold">
            Laboratorio de esta visita
          </h2>
          <ul className="flex flex-wrap gap-2">
            {labs.map((item) => (
              <li key={item.procedure.key} className="inline-flex min-h-11 items-center rounded-full bg-[#EDF0F3] px-3 text-sm font-semibold text-[#33424F]">
                {item.procedure.label} <ConditionTags item={item} /> {chip(item)}
              </li>
            ))}
          </ul>
          <p className="mt-3 rounded-xl border-l-[5px] border-[#B7791F] bg-[#FFF1D6] px-3 py-3 text-sm text-[#4F3000]">
            <span className="font-semibold">Kit, tubos y volumen: no están en el protocolo.</span> Completar con el manual de laboratorio. No se inventan acá.
          </p>
        </section>

        <section className={cardClass} aria-labelledby="cabina-med">
          <h2 id="cabina-med" className="mb-2 text-base font-semibold">
            Medicación
          </h2>
          <ul>
            {meds.map((item) => (
              <li key={item.procedure.key} className="flex gap-3 border-t border-alphi-border py-3 text-sm first:border-t-0">
                <ToneChip tone={item.procedure.tone ?? 'grey'} label={item.procedure.label} />
                <span>
                  {item.procedure.detail} {chip(item)}
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section className={cardClass} aria-labelledby="cabina-consent">
          <h2 id="cabina-consent" className="mb-2 text-base font-semibold">
            Consentimientos
          </h2>
          <ul>
            {patient.consents.map((item) => (
              <li key={item.label} className="flex gap-3 border-t border-alphi-border py-3 text-sm first:border-t-0">
                <ToneChip tone={item.state === 'vigente' ? 'green' : 'amber'} label={item.state === 'vigente' ? 'Vigente' : 'Revisar'} />
                <span>
                  {item.label}
                  {item.page !== null ? <span className="ml-1 inline-block rounded-md bg-[#E2F0F4] px-1.5 py-0.5 font-mono text-[11px] font-medium text-[#0A4455]">p. {item.page}</span> : null}
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <form
        className="fixed inset-x-0 bottom-14 z-30 border-t border-alphi-border bg-white p-3 lg:static lg:rounded-2xl lg:border lg:p-4"
        onSubmit={(event: FormEvent) => {
          event.preventDefault()
          setReply(answerQuestion(question, demoStudy.answers))
        }}
      >
        <label className="block text-sm font-semibold" htmlFor="cabina-pregunta">
          Preguntar sobre esta visita
        </label>
        <div className="mt-2 flex flex-col gap-2 sm:flex-row">
          <input
            ref={askRef}
            id="cabina-pregunta"
            className={fieldClass}
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="¿Puedo comer? ¿Qué extraigo?"
          />
          <button type="submit" className={`inline-flex min-h-11 items-center justify-center rounded-lg bg-[#0F5E73] px-4 text-sm font-semibold text-white ${focusRing}`}>
            Preguntar
          </button>
        </div>
        {reply ? (
          <p className="mt-2 text-sm" role="status">
            {reply.text}
            {reply.page !== null ? ` [${reply.page}]` : ''}
          </p>
        ) : null}
      </form>
      <p className="text-center text-sm text-alphi-muted">Datos ficticios. Verificar siempre con el protocolo original.</p>
      </>
      ) : null}
      {view === 'cabina' && panelItem?.cell ? (
        <>
          {desktopPanel ? null : (
            <button type="button" className="fixed inset-0 z-40 bg-[#17222D]/40" aria-label="Cerrar el texto de la página" onClick={() => setPanelKey(null)} />
          )}
          <OrigenPanel
            visitLabel={`${visit.printedId} · ${visit.label}`}
            procedureLabel={panelItem.procedure.label}
            page={panelItem.cell.page}
            quote={quoteEdits[`${visit.key}:${panelItem.procedure.key}`] ?? panelItem.cell.quote}
            highlights={panelItem.cell.highlights}
            howRead={panelItem.cell.howRead}
            sourceLabel={panelItem.cell.sourceLabel}
            low={panelItem.cell.certainty === 'low' || doubted.includes(panelItem.procedure.key)}
            reviewed={reviewed.includes(panelItem.procedure.key)}
            modal={!desktopPanel}
            onClose={() => setPanelKey(null)}
            onDoubt={() => markDoubt(panelItem.procedure.key)}
            onSaveQuote={(quote) => setQuoteEdits((current) => ({ ...current, [`${visit.key}:${panelItem.procedure.key}`]: quote }))}
          />
        </>
      ) : null}
      <PrintSheets today={today} />
      <nav className="fixed inset-x-0 bottom-0 z-30 flex border-t border-alphi-border bg-white lg:hidden" aria-label="Navegación de la demo">
        <button type="button" className={barButton(view === 'cabina')} onClick={() => setView('cabina')}>
          Inicio
        </button>
        <button type="button" className={barButton(view === 'semana')} onClick={() => setView('semana')}>
          Estudio
        </button>
        <button
          type="button"
          className={barButton(false)}
          onClick={() => {
            setView('cabina')
            window.setTimeout(() => askRef.current?.focus(), 0)
          }}
        >
          Preguntar
        </button>
        <button type="button" className={barButton(moreOpen)} aria-expanded={moreOpen} onClick={() => setMoreOpen((open) => !open)}>
          Más
        </button>
      </nav>
      {moreOpen ? (
        <div role="dialog" aria-label="Más opciones" className="fixed inset-x-0 bottom-14 z-40 rounded-t-2xl border border-alphi-border bg-white p-4 shadow-alphi-modal lg:hidden">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-base font-semibold">Pacientes ficticios</h2>
            <button type="button" className={`inline-flex min-h-11 items-center px-3 text-sm font-semibold text-[#0F5E73] ${focusRing}`} onClick={() => setMoreOpen(false)}>
              Cerrar
            </button>
          </div>
          <ul className="flex flex-col gap-2">
            {demoStudy.patients.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className={`inline-flex min-h-11 w-full items-center rounded-lg border border-alphi-border px-3 text-left text-sm font-semibold ${focusRing}`}
                  onClick={() => {
                    setPatientId(item.id)
                    setView('cabina')
                    setMoreOpen(false)
                  }}
                >
                  {patientOption(item)}
                </button>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-sm text-alphi-muted">Datos ficticios. Verificar siempre con el protocolo original.</p>
        </div>
      ) : null}
      <style>{printCss}</style>
    </div>
  )
}

const printCss = `
.cabina-print { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
@media print {
  @page { size: A4 landscape; margin: 12mm; }
  body * { visibility: hidden; }
  .cabina-print, .cabina-print * { visibility: visible; }
  .cabina-print { position: absolute; left: 0; top: 0; width: 100%; height: auto; margin: 0; overflow: visible; clip: auto; white-space: normal; }
  .cabina-sheet { break-after: page; page-break-after: always; }
  .cabina-sheet:last-child { break-after: auto; page-break-after: auto; }
  .cabina-sheet h1 { font-size: 22px; margin: 0 0 8px; }
  .cabina-sheet p, .cabina-sheet li { font-size: 14px; line-height: 1.4; }
}
`

function viewButton(active: boolean): string {
  return `inline-flex min-h-11 items-center rounded-lg px-4 text-sm font-semibold ${focusRing} ${active ? 'bg-[#0F5E73] text-white' : 'border border-alphi-border bg-white text-alphi-navy'}`
}

function phonePanel(active: boolean): string {
  return active ? 'block' : 'max-lg:hidden'
}

function barButton(active: boolean): string {
  return `inline-flex min-h-11 flex-1 items-center justify-center text-sm font-semibold ${focusRing} ${active ? 'text-[#0F5E73]' : 'text-[#33424F]'}`
}

function WindowCard({
  plan,
  visit,
  today,
  anchor,
  anchorIso,
  onAnchor,
}: {
  plan: VisitPlan
  visit: VisitDef
  today: Date
  anchor: Date
  anchorIso: string
  onAnchor: (value: string) => void
}) {
  const summary = describePlan(plan, today)
  return (
    <div aria-label={`${windowText(visit)}. ${summary}`}>
      <div className="mb-2 flex items-center justify-between gap-3 text-xs text-alphi-muted">
        <span>{windowText(visit)}</span>
        <span>Hoy: {dateFormat.format(today)}</span>
      </div>
      {plan.target && plan.opens && plan.closes ? <WindowBar plan={plan} today={today} /> : null}
      <div className="mt-2 grid grid-cols-3 gap-2 text-sm">
        <DateMark label="abre" date={plan.opens} />
        <DateMark label="fecha objetivo" date={plan.target} center />
        <DateMark label="cierra" date={plan.closes} end />
      </div>
      <p className={`mt-3 inline-flex min-h-11 items-center rounded-full px-3 text-sm font-semibold ${STATUS_CLASS[plan.status]}`}>{STATUS_LABEL[plan.status]}</p>
      <p className="mt-2 text-sm">{summary}</p>
      <label className="mt-3 block text-sm font-semibold" htmlFor="demo-anchor">
        Visita 2 real
      </label>
      <input
        id="demo-anchor"
        className={`${fieldClass} mt-1`}
        type="date"
        value={anchorIso}
        onChange={(event) => {
          if (/^\d{4}-\d{2}-\d{2}$/.test(event.target.value)) onAnchor(event.target.value)
        }}
      />
      <p className="mt-1 text-xs text-alphi-muted">Ancla de este paciente: {dateFormat.format(anchor)}. Cambiarla recalcula la ventana.</p>
    </div>
  )
}

function WindowBar({ plan, today }: { plan: VisitPlan; today: Date }) {
  if (!plan.opens || !plan.closes || !plan.target) return null
  const start = diffDays(plan.opens, today) < 0 ? today : plan.opens
  const end = diffDays(plan.closes, today) > 0 ? today : plan.closes
  const span = Math.max(1, diffDays(start, end))
  const at = (date: Date) => (diffDays(start, date) / span) * 100
  return (
    <div className="relative h-14" aria-hidden="true">
      <div className="absolute inset-x-0 top-6 h-1.5 rounded-full bg-[#D5DCE3]" />
      <div
        className="absolute top-5 h-4 rounded-full bg-[#BFDDE6]"
        style={{ left: `${at(plan.opens)}%`, width: `${Math.max(4, at(plan.closes) - at(plan.opens))}%` }}
      />
      <span className="absolute top-2 h-5 w-0.5 bg-alphi-navy" style={{ left: `${at(today)}%` }} />
      <span className="absolute top-3 h-3.5 w-3.5 -translate-x-1/2 rounded-full bg-[#0F5E73] ring-4 ring-white" style={{ left: `${at(plan.target)}%` }} />
    </div>
  )
}

function AlertCard({
  item,
  consultOpen,
  manualLoaded,
  marked,
  onOpen,
  onConsult,
  onManual,
}: {
  item: SheetItem
  consultOpen: boolean
  manualLoaded: boolean
  marked: boolean
  onOpen: (key: string) => void
  onConsult: () => void
  onManual: () => void
}) {
  const tone = item.procedure.section === 'block' ? 'red' : item.procedure.section === 'sponsor' ? 'violet' : 'amber'
  const title = item.procedure.section === 'block' ? 'Bloqueo · no seguir sin esto' : item.procedure.section === 'undefined' ? 'No definido en el protocolo' : 'Consultar al patrocinador'
  const box = tone === 'red' ? 'border-[#A6314F] bg-[#FBE3E7] text-[#5B1226]' : tone === 'violet' ? 'border-[#6A4C9C] bg-[#ECE6F7] text-[#2E1C5C]' : 'border-[#B7791F] bg-[#FFF1D6] text-[#4F3000]'
  return (
    <article className={`flex flex-col gap-2 rounded-xl border-l-[5px] px-3 py-3 text-sm ${box}`}>
      <h3 className="font-semibold">{title}</h3>
      <p>
        <span className="font-semibold">{item.procedure.label}.</span> {item.procedure.detail}
      </p>
      <PageChip item={item} marked={marked} onOpen={onOpen} />
      {item.procedure.action === 'consult' && item.procedure.consultDraft ? (
        <>
          <button type="button" className={`inline-flex min-h-11 w-fit items-center rounded-lg border-[1.5px] border-current px-3 text-sm font-semibold ${focusRing}`} aria-expanded={consultOpen} onClick={onConsult}>
            Redactar consulta
          </button>
          {consultOpen ? (
            <textarea className={`${fieldClass} min-h-28 bg-white text-[#17222D]`} readOnly value={item.procedure.consultDraft} aria-label={`Consulta sobre ${item.procedure.label}`} />
          ) : null}
        </>
      ) : null}
      {item.procedure.action === 'manual' ? (
        manualLoaded ? (
          <p>Dato de demostración anotado en este navegador. El protocolo no lo define y esta demo no consulta un manual.</p>
        ) : (
          <button type="button" className={`inline-flex min-h-11 w-fit items-center rounded-lg border-[1.5px] border-current px-3 text-sm font-semibold ${focusRing}`} onClick={onManual}>
            Cargar dato del manual
          </button>
        )
      ) : null}
    </article>
  )
}

function PageChip({ item, marked, onOpen }: { item: SheetItem; marked: boolean; onOpen: (key: string) => void }) {
  if (!item.cell) return null
  return (
    <button
      type="button"
      className={`inline-flex min-h-11 items-center rounded-md px-2 font-mono text-[11px] font-medium ${focusRing} ${marked ? 'border border-dashed border-[#B7791F] bg-[#FFF1D6] text-[#6B4200]' : 'bg-[#E2F0F4] text-[#0A4455]'}`}
      onClick={(event) => {
        event.stopPropagation()
        onOpen(item.procedure.key)
      }}
    >
      p. {item.cell.page}
    </button>
  )
}

function ConditionTags({ item }: { item: SheetItem }) {
  if (item.procedure.conditions.length === 0) return null
  return (
    <>
      {item.procedure.conditions.map((condition) => (
        <span key={condition.key} className="ml-1 inline-block rounded bg-[#ECE6F7] px-1.5 py-0.5 text-[11px] font-semibold text-[#4A2F87]">
          {condition.expr}
        </span>
      ))}
    </>
  )
}

function ToneChip({ tone, label }: { tone: 'red' | 'amber' | 'violet' | 'green' | 'grey' | 'teal'; label: string }) {
  const color = {
    red: 'bg-[#FBE3E7] text-[#8C1D3A]',
    amber: 'bg-[#FFF1D6] text-[#6B4200]',
    violet: 'bg-[#ECE6F7] text-[#4A2F87]',
    green: 'bg-[#DDF0E6] text-[#0E4D33]',
    grey: 'bg-[#EDF0F3] text-[#33424F]',
    teal: 'bg-[#E2F0F4] text-[#0A4455]',
  }[tone]
  return <span className={`inline-flex h-7 shrink-0 items-center rounded-full px-2 text-xs font-semibold ${color}`}>{label}</span>
}

function useDesktopPanel(): boolean {
  const [desktop, setDesktop] = useState(false)
  useEffect(() => {
    const media = window.matchMedia('(min-width: 768px)')
    const apply = () => setDesktop(media.matches)
    apply()
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [])
  return desktop
}

function VisitFlag({ on, label, tone = 'teal' }: { on: boolean; label: string; tone?: 'teal' | 'amber' | 'grey' }) {
  if (!on) return null
  return <ToneChip tone={tone} label={label} />
}

function CountChip({ tone, label }: { tone: 'red' | 'amber' | 'violet'; label: string }) {
  return <span className={`inline-flex min-h-11 items-center rounded-full px-3 text-sm font-semibold ${tone === 'red' ? STATUS_CLASS.rojo : tone === 'amber' ? STATUS_CLASS.ambar : 'bg-[#ECE6F7] text-[#4A2F87]'}`}>{label}</span>
}

function DateMark({ label, date, center, end }: { label: string; date: Date | null; center?: boolean; end?: boolean }) {
  return (
    <p className={center ? 'text-center' : end ? 'text-right' : ''}>
      <span className="font-semibold">{date ? dateFormat.format(date) : '—'}</span>
      <br />
      <span className="text-xs text-alphi-muted">{label}</span>
    </p>
  )
}

function itemsOf(items: SheetItem[], section: SheetSection): SheetItem[] {
  return items.filter((item) => item.procedure.section === section)
}

function chipButton(on: boolean): string {
  return `inline-flex min-h-11 items-center rounded-full px-3 text-sm font-semibold ${focusRing} ${on ? 'bg-[#ECE6F7] text-[#4A2F87]' : 'bg-[#EDF0F3] text-[#33424F]'}`
}

function patientOption(patient: PatientDef): string {
  const marks = [
    `rama ${patient.arm}`,
    patient.conditions.dt2 ? 'DT2' : null,
    patient.conditions.erc ? 'ERC' : null,
    patient.conditions.ic ? 'IC' : null,
    patient.conditions.wocbp ? 'edad fértil' : null,
  ].filter(Boolean)
  return `${patient.code} · ${marks.join(' · ')}`
}

function windowText(visit: VisitDef): string {
  if (!visit.window) return 'Sin ventana en el protocolo'
  const { before, after } = visit.window
  if (before === after) return `Ventana permitida · ±${before} días`
  return `Ventana permitida · −${before} / +${after} días`
}

function describePlan(plan: VisitPlan, today: Date): string {
  if (plan.status === 'sin_fecha' || plan.target === null) {
    return 'Esta visita depende de un evento. El protocolo no le fija fecha.'
  }
  const untilTarget = plan.daysUntilTarget ?? 0
  const targetText = untilTarget === 0 ? 'La fecha objetivo es hoy.' : untilTarget > 0 ? `Faltan ${untilTarget} días para la fecha objetivo.` : `La fecha objetivo fue hace ${Math.abs(untilTarget)} días.`
  if (plan.opens === null || plan.daysUntilClose === null) return targetText
  const untilOpen = diffDays(today, plan.opens)
  if (untilOpen > 0) return `${targetText} La ventana abre en ${untilOpen} días.`
  if (plan.daysUntilClose < 0) return `${targetText} La ventana cerró hace ${Math.abs(plan.daysUntilClose)} días.`
  if (plan.daysUntilClose === 0) return `${targetText} La ventana cierra hoy.`
  return `${targetText} La ventana cierra en ${plan.daysUntilClose} días.`
}

function countLabel(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`
}
