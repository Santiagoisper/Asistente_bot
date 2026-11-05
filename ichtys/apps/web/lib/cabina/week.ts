import { buildSheet } from './filter'
import { addDays, diffDays, planVisit, startOfDay, type AgendaItem, type VisitStatus } from './schedule'
import type { PatientDef, ProcedureDef, VisitDef } from './types'

const CLOSING_DAYS = 7

export interface ClosingWindow {
  patientCode: string
  visitKey: string
  visitLabel: string
  daysUntilClose: number
  status: VisitStatus
}

export function visitsOnDay(patients: PatientDef[], visits: VisitDef[], today: Date, day: Date): AgendaItem[] {
  const todayDay = startOfDay(today)
  const targetDay = startOfDay(day)
  const items: AgendaItem[] = []
  for (const patient of patients) {
    const anchor = addDays(todayDay, patient.anchorOffsetDays)
    for (const visit of visits) {
      const plan = planVisit(visit, anchor, todayDay)
      if (plan.target != null && diffDays(plan.target, targetDay) === 0) {
        items.push({ patientCode: patient.code, visitKey: visit.key, status: plan.status, target: plan.target })
      }
    }
  }
  return items
}

export function closingWindows(patients: PatientDef[], visits: VisitDef[], today: Date): ClosingWindow[] {
  const todayDay = startOfDay(today)
  const rows: ClosingWindow[] = []
  for (const patient of patients) {
    const anchor = addDays(todayDay, patient.anchorOffsetDays)
    for (const visit of visits) {
      const plan = planVisit(visit, anchor, todayDay)
      if (plan.status === 'sin_fecha' || plan.daysUntilClose == null) continue
      if (plan.daysUntilClose < 0 || plan.daysUntilClose > CLOSING_DAYS) continue
      rows.push({
        patientCode: patient.code,
        visitKey: visit.key,
        visitLabel: visit.label,
        daysUntilClose: plan.daysUntilClose,
        status: plan.status,
      })
    }
  }
  rows.sort((left, right) => left.daysUntilClose - right.daysUntilClose || left.patientCode.localeCompare(right.patientCode) || left.visitKey.localeCompare(right.visitKey))
  return rows
}

export function prepForDay(items: AgendaItem[], patients: PatientDef[], visits: VisitDef[], procedures: ProcedureDef[]): string[] {
  const labels: string[] = []
  for (const item of items) {
    const patient = patients.find((entry) => entry.code === item.patientCode)
    const visit = visits.find((entry) => entry.key === item.visitKey)
    if (!patient || !visit) continue
    const sheet = buildSheet(visit, procedures, [], { ...patient.conditions, arm: patient.arm })
    for (const row of sheet.shown) {
      if (row.procedure.section === 'before' && !labels.includes(row.procedure.label)) labels.push(row.procedure.label)
    }
  }
  return labels
}
