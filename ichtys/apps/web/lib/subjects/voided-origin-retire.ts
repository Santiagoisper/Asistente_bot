import type { LabObservation, Medication, PatientProfile, RetiredProfileFacts } from '@ichtys/clinical'

/**
 * Retirar del perfil lo que entró desde una evolución que después se declaró registrada en el
 * sujeto equivocado (docs/decisions/grabacion-en-sujeto-equivocado.md, punto 4 bis).
 *
 * - Los laboratorios cuyo origen es esa evolución salen **todos**: son de otra persona.
 * - La edad, la presión arterial, las medicaciones y las condiciones no guardan origen: sale
 *   solo lo que la persona eligió. Esta función no elige nada por su cuenta.
 * - Nada se destruye: lo retirado pasa a `retiredFacts`, con de qué evolución era, quién lo
 *   retiró y cuándo. La elegibilidad no lee ese campo.
 *
 * Función pura: no toca el perfil que recibe.
 */
export interface RetireSelection {
  evolutionId: string
  /** Identificador de usuario de quien retira. */
  by: string
  at: Date
  removeAge?: boolean
  removeBloodPressure?: boolean
  /** Nombres tal como están en el perfil; no distingue mayúsculas. */
  medications?: readonly string[]
  conditions?: readonly string[]
  /**
   * La persona declara que revisó el perfil y no hay nada de esa evolución. Sin esta
   * declaración, una revisión que no saca nada no se registra: apagar el aviso no puede ser
   * lo que pasa por defecto.
   */
  nothingToRetire?: boolean
}

/** Cuánto salió. Es lo que va al registro: cantidades, nunca nombres ni valores. */
export interface RetiredCounts {
  labs: number
  medications: number
  conditions: number
  age: boolean
  bloodPressure: boolean
}

/**
 * Lo que la persona eligió no se puede aplicar sobre el perfil como está. No se retira nada.
 * - `not_in_profile`: pidió sacar una medicación o una condición que ya no está; alguien cambió
 *   el perfil después de que la pantalla lo mostró. La pantalla recarga y vuelve a elegir.
 * - `selection_required`: no hay nada que sacar y no declaró que no había nada.
 * - `not_empty`: declaró que no había nada, y hay.
 */
export type RetireSelectionErrorCode = 'not_in_profile' | 'selection_required' | 'not_empty'

export class RetireSelectionError extends Error {
  constructor(readonly code: RetireSelectionErrorCode = 'not_in_profile') {
    super(`retire selection: ${code}`)
    this.name = 'RetireSelectionError'
  }
}

function originOf(lab: LabObservation): string | undefined {
  return lab.source?.kind === 'evolution' ? lab.source.evolutionId : lab.sourceEvolutionId
}

const lower = (text: string) => text.trim().toLowerCase()

/** Parte `items` en los elegidos y el resto. Tira si algún elegido no está. */
function pick<T>(items: readonly T[], nameOf: (item: T) => string, chosen: readonly string[] | undefined): { taken: T[]; kept: T[] } {
  const wanted = new Set((chosen ?? []).map(lower))
  const taken = items.filter((item) => wanted.has(lower(nameOf(item))))
  const found = new Set(taken.map((item) => lower(nameOf(item))))
  for (const name of wanted) if (!found.has(name)) throw new RetireSelectionError()
  return { taken, kept: items.filter((item) => !wanted.has(lower(nameOf(item)))) }
}

function without(record: Record<string, unknown> | undefined, names: readonly string[]): Record<string, unknown> | undefined {
  if (!record) return undefined
  const gone = new Set(names.map(lower))
  const rest = Object.fromEntries(Object.entries(record).filter(([key]) => !gone.has(lower(key))))
  return Object.keys(rest).length > 0 ? rest : undefined
}

/** Un objeto sin las claves que quedaron en `undefined`, o `undefined` si no quedó ninguna. */
function compact<T extends Record<string, unknown>>(value: T): T | undefined {
  const entries = Object.entries(value).filter(([, entry]) => entry !== undefined)
  return entries.length > 0 ? (Object.fromEntries(entries) as T) : undefined
}

export function retireFromVoidedEvolution(profile: PatientProfile, selection: RetireSelection): { profile: PatientProfile; removed: RetiredCounts } {
  const retiredLabs = profile.labs.filter((lab) => originOf(lab) === selection.evolutionId)
  const labs = profile.labs.filter((lab) => originOf(lab) !== selection.evolutionId)
  const medications = pick<Medication>(profile.medications, (med) => med.name, selection.medications)
  const conditions = pick<string>(profile.conditions, (condition) => condition, selection.conditions)

  const age = selection.removeAge === true && profile.demographics?.ageYears !== undefined
  const pressure = profile.vitals && compact({ ...profile.vitals })
  const bloodPressure = selection.removeBloodPressure === true && pressure !== undefined

  const empty = retiredLabs.length === 0 && medications.taken.length === 0 && conditions.taken.length === 0 && !age && !bloodPressure
  if (empty && selection.nothingToRetire !== true) throw new RetireSelectionError('selection_required')
  if (!empty && selection.nothingToRetire === true) throw new RetireSelectionError('not_empty')

  const entry: RetiredProfileFacts = {
    evolutionId: selection.evolutionId,
    retiredAt: selection.at.toISOString(),
    retiredBy: selection.by,
    labs: retiredLabs,
    medications: medications.taken,
    conditions: conditions.taken,
    ...(age ? { ageYears: profile.demographics!.ageYears } : {}),
    ...(bloodPressure ? { vitals: pressure } : {}),
  }

  const confidence = profile.fieldConfidence
  const fieldConfidence =
    confidence &&
    compact({
      ageYears: age ? undefined : confidence.ageYears,
      bloodPressure: bloodPressure ? undefined : confidence.bloodPressure,
      labs: without(confidence.labs, retiredLabs.map((lab) => lab.name)),
      medications: without(confidence.medications, medications.taken.map((med) => med.name)),
      conditions: without(confidence.conditions, conditions.taken),
    })

  const { demographics, vitals, fieldConfidence: _confidence, lastEvolutionId, ...rest } = profile
  const next: PatientProfile = {
    ...rest,
    ...(demographics && !age ? { demographics } : {}),
    ...(vitals && !bloodPressure ? { vitals } : {}),
    labs,
    medications: medications.kept,
    conditions: conditions.kept,
    ...(fieldConfidence ? { fieldConfidence: fieldConfidence as PatientProfile['fieldConfidence'] } : {}),
    retiredFacts: [...(profile.retiredFacts ?? []), entry],
    lastUpdatedAt: selection.at.toISOString(),
    // La anulada deja de figurar como la última evolución que escribió el perfil.
    ...(lastEvolutionId && lastEvolutionId !== selection.evolutionId ? { lastEvolutionId } : {}),
  }

  return {
    profile: next,
    removed: { labs: retiredLabs.length, medications: medications.taken.length, conditions: conditions.taken.length, age, bloodPressure },
  }
}
