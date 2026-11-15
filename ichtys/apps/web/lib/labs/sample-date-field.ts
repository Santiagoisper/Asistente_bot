/**
 * El campo «Fecha de la muestra» de la pantalla de revisión de un informe (C4, decisión D3 de
 * docs/decisions/huella-y-procedencia-de-archivos.md). El lector propone; la persona confirma,
 * escribe otra o declara que el informe no la trae. Sin dependencias de pantalla: se prueba solo.
 */
import { acceptableSampleDate, latestSampleDate, proposeSampleDate } from '@ichtys/clinical'

export interface SampleDateField {
  /** Lo que hay en el campo: `YYYY-MM-DD` o vacío. */
  value: string
  /** La persona declaró que el informe no trae la fecha de la muestra. */
  unknown: boolean
  /** Lo que el lector leyó en el informe, si leyó algo. */
  proposed: string | null
}

export function initialSampleDateField(transcriptionLines: readonly string[]): SampleDateField {
  const proposed = proposeSampleDate(transcriptionLines)
  return { value: proposed ?? '', unknown: false, proposed }
}

export type SampleDateDecision = { ok: true; sampleDate: string | null } | { ok: false; reason: 'missing' | 'invalid' }

/** Lo que viaja al confirmar. Vacía y sin declarar no es «desconocida»: falta decidir. */
export function sampleDateDecision(field: SampleDateField, today: string): SampleDateDecision {
  if (field.unknown) return { ok: true, sampleDate: null }
  if (field.value === '') return { ok: false, reason: 'missing' }
  return acceptableSampleDate(field.value, today) ? { ok: true, sampleDate: field.value } : { ok: false, reason: 'invalid' }
}

const spanish = (iso: string): string => iso.split('-').reverse().join('/')

export function sampleDateHelp(field: SampleDateField): string {
  if (field.unknown) return 'Los valores quedan guardados con fecha de muestra desconocida.'
  if (field.proposed && field.value === field.proposed) return 'Leída del informe. Comprobala contra el informe antes de confirmar.'
  if (field.proposed && field.value === '') return `La borraste. En el informe se leyó ${spanish(field.proposed)}.`
  if (field.proposed) return `La escribiste vos. En el informe se leyó ${spanish(field.proposed)}.`
  return 'No se encontró en el informe. Es la fecha de extracción o toma de la muestra, no la de emisión.'
}

/** El `max` del calendario: el mismo límite que usa `sampleDateDecision`, no uno más corto. */
export function sampleDateMax(today: string): string | undefined {
  return latestSampleDate(today) ?? undefined
}
