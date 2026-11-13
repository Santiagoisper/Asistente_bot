import type { CriterionAssessment, MissingDatum } from '../profile-schema'

/**
 * La guía según el protocolo (docs/decisions/consulta-dictada.md, D18): qué más decir en
 * este estudio, para este sujeto.
 *
 * Sale de los criterios que quedaron «a revisar» porque falta un dato que el sistema sabe
 * leer. No pide lo que no sabe leer (cuánto hace que toma la metformina): pedirlo sería
 * hacerle decir al médico algo que después no cambia nada. Cada frase de acá está cubierta
 * por una prueba que la dicta y comprueba que el dato llega al criterio.
 *
 * Para una exclusión, la guía enseña las dos frases: la que la despeja y la que la activa.
 * Mostrar solo «sin …» empujaría a decir que no.
 */
export interface StudyPrompt {
  id: MissingDatum | 'pregnancy-lactation'
  /** Números de los criterios que piden este dato. */
  criteria: string[]
  /** Qué falta, en pocas palabras. */
  ask: string
  /** Cómo decirlo. Vacío cuando el dato no se dicta (llega por otro camino). */
  say: string[]
  /** Solo en exclusiones: cómo decirlo cuando el antecedente o el estado SÍ está. */
  sayIfPresent?: string[]
  note?: string
}

type Template = Omit<StudyPrompt, 'criteria'>

const TEMPLATES: Record<StudyPrompt['id'], Template> = {
  age: { id: 'age', ask: 'La edad', say: ['Paciente de 58 años.'] },
  hba1c: {
    id: 'hba1c',
    ask: 'La hemoglobina glicosilada, si ya tenés el resultado',
    say: ['Hemoglobina glicosilada 7 coma 9 por ciento.'],
    note: 'Si no, se resuelve al cargar el laboratorio.',
  },
  'weight-height': { id: 'weight-height', ask: 'El peso y la talla', say: ['Peso 78 kilos.', 'Talla 1 metro 63.'] },
  egfr: { id: 'egfr', ask: 'El filtrado glomerular', say: [], note: 'No se dicta: se resuelve al cargar el laboratorio.' },
  pancreatitis: {
    id: 'pancreatitis',
    ask: 'Si tuvo pancreatitis',
    say: ['Sin antecedentes de pancreatitis.'],
    sayIfPresent: ['Antecedente de pancreatitis.'],
  },
  'pregnancy-lactation': {
    id: 'pregnancy-lactation',
    ask: 'Embarazo y lactancia',
    say: ['Sin embarazo ni lactancia.'],
    sayIfPresent: ['Embarazo en curso.', 'Lactancia en curso.'],
  },
  pregnancy: { id: 'pregnancy', ask: 'Embarazo', say: ['Sin embarazo.'], sayIfPresent: ['Embarazo en curso.'] },
  lactation: { id: 'lactation', ask: 'Lactancia', say: ['Sin lactancia.'], sayIfPresent: ['Lactancia en curso.'] },
}

export function studyDictationPrompts(
  assessments: ReadonlyArray<Pick<CriterionAssessment, 'criterionNumber' | 'status'> & { missing?: readonly string[] }>,
): StudyPrompt[] {
  const prompts = new Map<StudyPrompt['id'], StudyPrompt>()
  for (const assessment of assessments) {
    if (assessment.status !== 'unknown' || !assessment.missing) continue
    const missing = assessment.missing.filter((datum): datum is MissingDatum => datum in TEMPLATES && datum !== 'pregnancy-lactation')
    // Embarazo y lactancia pedidos por el mismo criterio se dicen en una sola frase.
    const together = missing.includes('pregnancy') && missing.includes('lactation')
    const ids: StudyPrompt['id'][] = together
      ? [...missing.filter((datum) => datum !== 'pregnancy' && datum !== 'lactation'), 'pregnancy-lactation']
      : missing
    for (const id of ids) {
      const existing = prompts.get(id)
      if (existing) {
        if (!existing.criteria.includes(assessment.criterionNumber)) existing.criteria.push(assessment.criterionNumber)
      } else {
        prompts.set(id, { ...TEMPLATES[id], criteria: [assessment.criterionNumber] })
      }
    }
  }
  return [...prompts.values()]
}
