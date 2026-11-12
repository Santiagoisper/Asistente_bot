import type { LabReportRow, LabRowInput } from './lab-report-content'

/**
 * Cuánto hubo que tocar de lo que leyó la máquina para poder confirmar un
 * informe. Son solo cuentas: sirven para medir si la lectura ayuda (piloto) y
 * pueden ir al registro de auditoría sin llevar ningún valor clínico.
 *
 * Una fila confirmada se compara con la fila leída de la misma línea del
 * informe. Cada fila leída cae en una sola categoría:
 * - `valueCorrected`: cambió el valor impreso o la lectura numérica que la máquina había elegido.
 * - `decided`: la máquina no había elegido una lectura numérica y la persona eligió una.
 * - `labelCorrected`: el valor quedó igual y cambió el nombre, la unidad o el rango.
 * - `unchanged`: se aceptó tal cual.
 * - `removed`: la persona la quitó.
 * `added` son las filas confirmadas que la máquina no había leído (cargadas a
 * mano o tomadas de una línea que no había reconocido).
 *
 * Cuando una persona escribe un valor que no está en la línea del informe, la
 * pantalla deja la fila sin línea de origen. Esa fila sigue siendo la misma:
 * se empareja por nombre con la fila leída que quedó sin pareja y cuenta como
 * corrección de valor, no como «una quitada y una agregada».
 */
export interface ReviewOutcome {
  /** Filas que propuso la máquina. */
  machineRows: number
  /** De esas, cuántas dejó marcadas para que una persona decida. */
  needingDecision: number
  unchanged: number
  valueCorrected: number
  decided: number
  labelCorrected: number
  removed: number
  added: number
}

const key = (text: string) => text.trim().toLowerCase()

export function reviewOutcome(machine: readonly LabReportRow[], confirmed: readonly LabRowInput[]): ReviewOutcome {
  const outcome: ReviewOutcome = {
    machineRows: machine.length,
    needingDecision: machine.filter((row) => row.status === 'review' || row.mustDecide === true).length,
    unchanged: 0,
    valueCorrected: 0,
    decided: 0,
    labelCorrected: 0,
    removed: 0,
    added: 0,
  }

  // Filas confirmadas todavía sin emparejar, por línea del informe.
  const byLine = new Map<number, LabRowInput[]>()
  /** Filas confirmadas sin línea de origen: cargadas a mano, o corregidas a mano. */
  const byHand: LabRowInput[] = []
  for (const row of confirmed) {
    if (row.sourceLine === null) byHand.push(row)
    else byLine.set(row.sourceLine, [...(byLine.get(row.sourceLine) ?? []), row])
  }

  const take = (line: number, pick: (candidates: LabRowInput[]) => number): LabRowInput | undefined => {
    const candidates = byLine.get(line)
    if (!candidates || candidates.length === 0) return undefined
    const index = pick(candidates)
    return index < 0 ? undefined : candidates.splice(index, 1)[0]
  }

  // Primero las que conservan el nombre; después, lo que quede de la línea, en orden.
  const pending: LabReportRow[] = []
  const pairs: Array<[LabReportRow, LabRowInput]> = []
  for (const row of machine) {
    const match = row.sourceLine === null ? undefined : take(row.sourceLine, (candidates) => candidates.findIndex((candidate) => key(candidate.analyte) === key(row.analyte)))
    if (match) pairs.push([row, match])
    else pending.push(row)
  }
  for (const row of pending) {
    const sameLine = row.sourceLine === null ? undefined : take(row.sourceLine, () => 0)
    if (sameLine) {
      pairs.push([row, sameLine])
      continue
    }
    // Sin pareja en su línea: ¿es la fila que alguien corrigió a mano?
    const index = byHand.findIndex((candidate) => key(candidate.analyte) === key(row.analyte))
    if (index >= 0) pairs.push([row, byHand.splice(index, 1)[0]!])
    else outcome.removed += 1
  }

  for (const [before, after] of pairs) {
    if (before.printedValue !== after.printedValue || (before.value !== null && before.value !== after.value)) outcome.valueCorrected += 1
    else if (before.value === null && after.value !== null) outcome.decided += 1
    else if (key(before.analyte) !== key(after.analyte) || (before.unit ?? null) !== (after.unit ?? null) || (before.referenceRange ?? null) !== (after.referenceRange ?? null)) outcome.labelCorrected += 1
    else outcome.unchanged += 1
  }

  // Lo que quedó sin emparejar no lo había leído la máquina: a mano, o de una línea que no reconoció.
  outcome.added += byHand.length
  for (const rest of byLine.values()) outcome.added += rest.length
  return outcome
}
