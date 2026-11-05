import type { PatientDef, VisitDef, WindowSpec } from './types'

export type VisitStatus = 'sin_fecha' | 'verde' | 'ambar' | 'rojo'

export interface VisitPlan {
  target: Date | null
  opens: Date | null
  closes: Date | null
  daysUntilTarget: number | null
  daysUntilClose: number | null
  status: VisitStatus
}

export interface AgendaItem {
  patientCode: string
  visitKey: string
  status: VisitStatus
  target: Date
}

export interface AgendaDay {
  date: Date
  label: string
  items: AgendaItem[]
}

const WEEKDAYS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'] as const
const CLOSE_AMBER_DAYS = 3
const OPEN_AMBER_DAYS = 7

export function parseISODate(iso: string): Date {
  const [year, month, day] = iso.split('-').map(Number)
  return new Date(year ?? 1970, (month ?? 1) - 1, day ?? 1)
}

export function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

export function addDays(date: Date, days: number): Date {
  const next = startOfDay(date)
  next.setDate(next.getDate() + days)
  return next
}

/** Días enteros de `from` a `to` en calendario local. */
export function diffDays(from: Date, to: Date): number {
  return Math.round((startOfDay(to).getTime() - startOfDay(from).getTime()) / 86_400_000)
}

export function toISODate(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function canonicalDay(visit: VisitDef): number | null {
  if (visit.timing.kind === 'event' || visit.timing.value === null || visit.timing.unit === null) return null
  return visit.timing.unit === 'week' ? visit.timing.value * 7 : visit.timing.value
}

function occurrenceDays(visit: VisitDef): number[] {
  const base = canonicalDay(visit)
  if (base === null) return []
  const recurrence = visit.timing.recurrence
  if (visit.timing.kind !== 'recurrent' || recurrence === null) return [base]
  const step = recurrence.every * 7
  if (step <= 0) return [base]
  const until = recurrence.untilWeek === null ? base : recurrence.untilWeek * 7
  const days: number[] = []
  for (let day = base; day <= until; day += step) days.push(day)
  return days.length > 0 ? days : [base]
}

function statusFor(window: WindowSpec, target: Date, today: Date): Pick<VisitPlan, 'opens' | 'closes' | 'daysUntilClose' | 'status'> {
  const opens = addDays(target, -window.before)
  const closes = addDays(target, window.after)
  const daysUntilOpen = diffDays(today, opens)
  const daysUntilClose = diffDays(today, closes)
  let status: VisitStatus
  if (daysUntilClose < 0) status = 'rojo'
  else if (daysUntilOpen > 0) status = daysUntilOpen <= OPEN_AMBER_DAYS ? 'ambar' : 'verde'
  else status = daysUntilClose <= CLOSE_AMBER_DAYS ? 'ambar' : 'verde'
  return { opens, closes, daysUntilClose, status }
}

function planAt(target: Date, window: WindowSpec | null, today: Date): VisitPlan {
  const daysUntilTarget = diffDays(today, target)
  if (window === null) {
    return { target, opens: null, closes: null, daysUntilTarget, daysUntilClose: null, status: 'sin_fecha' }
  }
  return { target, daysUntilTarget, ...statusFor(window, target, today) }
}

export function planVisit(visit: VisitDef, anchor: Date, today: Date): VisitPlan {
  const days = occurrenceDays(visit)
  if (days.length === 0 || visit.window === null) {
    return { target: null, opens: null, closes: null, daysUntilTarget: null, daysUntilClose: null, status: 'sin_fecha' }
  }
  const todayDay = startOfDay(today)
  const plans = days.map((offset) => planAt(addDays(anchor, offset), visit.window, todayDay))
  const open = plans.find((plan) => plan.closes !== null && diffDays(todayDay, plan.closes) >= 0)
  return open ?? plans[plans.length - 1]!
}

export function weekAgenda(patients: PatientDef[], visits: VisitDef[], today: Date): AgendaDay[] {
  const todayDay = startOfDay(today)
  const weekday = todayDay.getDay()
  const monday = addDays(todayDay, weekday === 0 ? -6 : 1 - weekday)
  return Array.from({ length: 5 }, (_, index) => {
    const date = addDays(monday, index)
    const items: AgendaItem[] = []
    for (const patient of patients) {
      const anchor = addDays(todayDay, patient.anchorOffsetDays)
      for (const visit of visits) {
        const plan = planVisit(visit, anchor, todayDay)
        if (plan.target !== null && diffDays(plan.target, date) === 0) {
          items.push({ patientCode: patient.code, visitKey: visit.key, status: plan.status, target: plan.target })
        }
      }
    }
    return { date, label: `${WEEKDAYS[date.getDay()]} ${date.getDate()}`, items }
  })
}
