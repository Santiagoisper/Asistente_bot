import { labsFromLabReport, type LabObservation } from '@ichtys/clinical'
import type { LabReportRow } from './lab-report-content'

/**
 * Lo que un informe confirmado le suma al perfil del sujeto: sus valores numéricos, cada uno
 * con el informe del que salió (C4, D1). Las filas sin valor numérico no llegan al perfil.
 */
export function reportRowsToProfileLabs(rows: readonly LabReportRow[], reportId: string): LabObservation[] {
  return labsFromLabReport(
    rows
      .filter((row): row is LabReportRow & { value: number } => row.value !== null)
      // El rango de referencia viaja con el valor: es el que imprime ese laboratorio, y hay
      // criterios que se miden contra él («3 veces el límite superior normal»).
      .map((row) => ({
        name: row.analyte,
        value: row.value,
        ...(row.unit ? { unit: row.unit } : {}),
        ...(row.referenceRange && row.referenceRange.trim().length > 0 ? { referenceRange: row.referenceRange.trim().slice(0, 120) } : {}),
      })),
    reportId,
  )
}
