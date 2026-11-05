import type { CellDef, Condition, PatientState, ProcedureDef, SheetSection, VisitDef } from './types'

const SECTION_ORDER: SheetSection[] = ['before', 'day', 'block', 'undefined', 'sponsor', 'lab', 'med', 'consent']

export interface SheetItem {
  procedure: ProcedureDef
  cell: CellDef | null
}

export function conditionMatches(condition: Condition, state: PatientState, visit: VisitDef): boolean {
  switch (condition.key) {
    case 'dt2':
      return state.dt2
    case 'erc':
      return state.erc
    case 'ic':
      return state.ic
    case 'wocbp':
      return state.wocbp
    case 'arm:A':
      return state.arm === 'A'
    case 'arm:B':
      return state.arm === 'B'
    case 'fasting':
      return visit.attributes.fasting === true
    default:
      return false
  }
}

function sectionRank(section: SheetSection): number {
  const index = SECTION_ORDER.indexOf(section)
  return index === -1 ? SECTION_ORDER.length : index
}

function bySheetOrder(a: SheetItem, b: SheetItem): number {
  return sectionRank(a.procedure.section) - sectionRank(b.procedure.section) || a.procedure.order - b.procedure.order
}

export function buildSheet(
  visit: VisitDef,
  procedures: ProcedureDef[],
  cells: CellDef[],
  state: PatientState,
): { shown: SheetItem[]; hidden: SheetItem[] } {
  const shown: SheetItem[] = []
  const hidden: SheetItem[] = []
  for (const procedure of procedures) {
    if (!procedure.visitKeys.includes(visit.key)) continue
    const cell = cells.find((item) => item.visitKey === visit.key && item.procedureKey === procedure.key) ?? null
    const item = { procedure, cell }
    const applies = procedure.conditions.every((condition) => conditionMatches(condition, state, visit))
    if (applies) shown.push(item)
    else hidden.push(item)
  }
  shown.sort(bySheetOrder)
  hidden.sort(bySheetOrder)
  return { shown, hidden }
}
