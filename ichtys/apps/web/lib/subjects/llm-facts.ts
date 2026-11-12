import { z } from 'zod'

/**
 * Lo que se le pide al modelo al leer una evolución.
 *
 * Todas las propiedades son requeridas y las que pueden faltar son anulables:
 * los proveedores que validan la salida de forma estricta rechazan el pedido
 * (HTTP 400) si una propiedad es opcional o si el esquema trae restricciones
 * que no admiten (mínimos, largos, valores por defecto). Lo que el esquema ya
 * no restringe lo valida `normalizeLlmFacts`.
 *
 * Se mantiene chico a propósito: cada campo infla el pedido que corre sobre
 * texto clínico.
 */
export const llmFactsSchema = z.object({
  ageYears: z.number().nullable(),
  systolic: z.number().nullable(),
  diastolic: z.number().nullable(),
  labs: z.array(
    z.object({
      name: z.string(),
      value: z.number(),
      unit: z.string().nullable(),
    }),
  ),
  medications: z.array(
    z.object({
      name: z.string(),
      dose: z.string().nullable(),
      frequency: z.string().nullable(),
    }),
  ),
  conditions: z.array(z.string()),
})

export interface NormalizedLlmFacts {
  ageYears: number | undefined
  systolic: number | undefined
  diastolic: number | undefined
  labs: Array<{ name: string; value: number; unit?: string }>
  medications: Array<{ name: string; dose?: string; frequency?: string }>
  conditions: string[]
}

const positiveInt = (value: number | null): number | undefined => (value !== null && Number.isInteger(value) && value > 0 ? value : undefined)
const text = (value: string | null): string | undefined => {
  const trimmed = value?.trim() ?? ''
  return trimmed.length > 0 ? trimmed : undefined
}

/** Pasa la respuesta del modelo a la forma interna: sin nulos, sin textos vacíos y sin números imposibles. */
export function normalizeLlmFacts(raw: z.infer<typeof llmFactsSchema>): NormalizedLlmFacts {
  return {
    ageYears: positiveInt(raw.ageYears),
    systolic: positiveInt(raw.systolic),
    diastolic: positiveInt(raw.diastolic),
    labs: raw.labs.flatMap((lab) => {
      const name = text(lab.name)
      if (!name || !Number.isFinite(lab.value)) return []
      const unit = text(lab.unit)
      return [{ name, value: lab.value, ...(unit ? { unit } : {}) }]
    }),
    medications: raw.medications.flatMap((med) => {
      const name = text(med.name)
      if (!name) return []
      const dose = text(med.dose)
      const frequency = text(med.frequency)
      return [{ name, ...(dose ? { dose } : {}), ...(frequency ? { frequency } : {}) }]
    }),
    conditions: raw.conditions.flatMap((condition) => text(condition) ?? []),
  }
}
