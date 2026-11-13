import { CORRECTION_WORDS } from './corrections'
import { DICTATION_BLOCKS } from './template'

/**
 * La guía que el médico lee mientras dicta (docs/decisions/consulta-dictada.md, D13).
 *
 * Sale de las mismas constantes con las que se arma el borrador: lo que la guía
 * enseña a decir es exactamente lo que el sistema reconoce. Una prueba dicta la
 * guía entera y comprueba que cada frase cae en su apartado y que los datos se
 * leen; si alguien cambia la plantilla sin la guía, o al revés, esa prueba falla.
 */
export interface GuideStep {
  /** Lo que hay que decir en voz alta para abrir el apartado. Null: se empieza sin nombrar nada. */
  say: string | null
  title: string
  hint: string
  example: string
}

export const DICTATION_GUIDE_STEPS: readonly GuideStep[] = DICTATION_BLOCKS.map((block) => ({
  say: block.say,
  title: block.title,
  hint: block.hint,
  example: block.example,
}))

/** Cómo decir un dato para que se lea solo. Cada renglón está cubierto por una prueba de extracción. */
export const DICTATION_GLOSSARY: ReadonlyArray<{ what: string; say: string }> = [
  { what: 'Presión arterial', say: '«presión arterial 132 sobre 84» o «sistólica 132, diastólica 84»' },
  { what: 'Edad', say: '«paciente de 58 años»' },
  { what: 'Medicación', say: 'el nombre, la dosis y cada cuánto: «metformina 850 miligramos cada 12 horas»' },
  { what: 'Decimales', say: 'con «coma»: «7 coma 9 por ciento»' },
  { what: 'Fechas', say: 'día, mes y año completos: «10 de noviembre de 2026»' },
]

export const DICTATION_CORRECTION_EXAMPLE = 'Presión arterial 140 sobre 90. Corrijo, 132 sobre 84.'

export const DICTATION_GUIDE_RULES = {
  correction: {
    words: CORRECTION_WORDS,
    example: DICTATION_CORRECTION_EXAMPLE,
  },
  /** Lo que más falla al transcribir, medido con voz real el 12/11/2026. */
  alwaysCheck: ['apellidos', 'códigos de estudio', 'nombres de medicamentos y marcas'],
  nothingToReport: 'Sin novedades',
} as const

/** La guía dicha de corrido, como la devuelve una transcripción: nombre del apartado, punto, contenido. */
export function dictationGuideScript(): string {
  return DICTATION_GUIDE_STEPS.map((step) => (step.say ? `${step.say}. ${step.example}` : step.example)).join(' ')
}
